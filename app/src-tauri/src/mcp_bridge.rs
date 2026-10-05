use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const PROTOCOL_VERSION: u8 = 1;
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DISCOVERY_FILE_NAME: &str = "mcp-bridge.json";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    enabled: bool,
    port: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    name: String,
    root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryFile {
    protocol: u8,
    port: u16,
    token: String,
    pid: u32,
    app_version: String,
    project: Option<ProjectInfo>,
}

struct Runtime {
    enabled: bool,
    port: Option<u16>,
    token: Option<String>,
    project: Option<ProjectInfo>,
    listener_stop: Option<Arc<AtomicBool>>,
    listener_thread: Option<JoinHandle<()>>,
    dispatcher_thread: Option<JoinHandle<()>>,
    request_tx: Option<Sender<BridgeMessage>>,
}

pub struct McpBridgeState {
    config_dir: PathBuf,
    app_version: String,
    runtime: Mutex<Runtime>,
    ready: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, SyncSender<BridgeResponse>>>>,
    connections: Arc<Mutex<HashMap<u64, TcpStream>>>,
    next_connection_id: Arc<AtomicU64>,
    next_request_id: Arc<AtomicU64>,
}

enum BridgeMessage {
    Request(RequestJob),
    Shutdown,
}

struct RequestJob {
    client_id: Value,
    request_id: String,
    method: String,
    params: Value,
    client_reply: Sender<Value>,
}

#[derive(Debug)]
struct BridgeResponse {
    ok: bool,
    payload: Value,
}

impl McpBridgeState {
    pub fn new(config_dir: PathBuf, app_version: String) -> Self {
        // A stale advertisement from a previous crash must never outlive a new launch.
        let _ = fs::remove_file(config_dir.join(DISCOVERY_FILE_NAME));
        Self {
            config_dir,
            app_version,
            runtime: Mutex::new(Runtime {
                enabled: false,
                port: None,
                token: None,
                project: None,
                listener_stop: None,
                listener_thread: None,
                dispatcher_thread: None,
                request_tx: None,
            }),
            ready: Arc::new(AtomicBool::new(false)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_connection_id: Arc::new(AtomicU64::new(1)),
            next_request_id: Arc::new(AtomicU64::new(1)),
        }
    }

    fn enable(&self, app: AppHandle) -> Result<(), String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "MCP bridge state is unavailable")?;
        if runtime.enabled {
            return Ok(());
        }

        fs::create_dir_all(&self.config_dir)
            .map_err(|error| format!("could not create MCP discovery directory: {error}"))?;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("could not start the local MCP listener: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("could not configure the local MCP listener: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("could not read the MCP listener address: {error}"))?
            .port();
        let token = new_token()?;
        let discovery = DiscoveryFile {
            protocol: PROTOCOL_VERSION,
            port,
            token: token.clone(),
            pid: std::process::id(),
            app_version: self.app_version.clone(),
            project: runtime.project.clone(),
        };
        write_discovery(&self.discovery_path(), &discovery)
            .map_err(|error| format!("could not publish MCP discovery information: {error}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let (request_tx, request_rx) = mpsc::channel();
        let pending = Arc::clone(&self.pending);
        let ready = Arc::clone(&self.ready);
        let dispatcher_app = app.clone();
        let dispatcher_pending = Arc::clone(&pending);
        let dispatcher_ready = Arc::clone(&ready);
        let dispatcher_thread = thread::Builder::new()
            .name("hive-mcp-dispatch".to_string())
            .spawn(move || {
                dispatch_loop(
                    dispatcher_app,
                    request_rx,
                    dispatcher_pending,
                    dispatcher_ready,
                )
            })
            .map_err(|error| format!("could not start the MCP dispatcher: {error}"))?;

        runtime.enabled = true;
        runtime.port = Some(port);
        runtime.token = Some(token.clone());
        runtime.listener_stop = Some(Arc::clone(&stop));
        runtime.request_tx = Some(request_tx.clone());
        runtime.dispatcher_thread = Some(dispatcher_thread);

        let connections = Arc::clone(&self.connections);
        let next_connection_id = Arc::clone(&self.next_connection_id);
        let next_request_id = Arc::clone(&self.next_request_id);
        let app_version = self.app_version.clone();
        let listener_thread = thread::Builder::new()
            .name("hive-mcp-listener".to_string())
            .spawn(move || {
                accept_loop(
                    listener,
                    stop,
                    token,
                    app_version,
                    request_tx,
                    connections,
                    next_connection_id,
                    next_request_id,
                )
            });
        match listener_thread {
            Ok(thread) => runtime.listener_thread = Some(thread),
            Err(error) => {
                runtime.enabled = false;
                runtime.port = None;
                runtime.token = None;
                runtime.listener_stop = None;
                runtime.request_tx = None;
                if let Some(dispatcher) = runtime.dispatcher_thread.take() {
                    let _ = dispatcher.join();
                }
                let _ = fs::remove_file(self.discovery_path());
                return Err(format!("could not start the MCP listener thread: {error}"));
            }
        }
        Ok(())
    }

    fn disable(&self) {
        self.ready.store(false, Ordering::SeqCst);
        let (listener_stop, listener_thread, dispatcher_thread, request_tx) = {
            let Ok(mut runtime) = self.runtime.lock() else {
                return;
            };
            runtime.enabled = false;
            runtime.port = None;
            runtime.token = None;
            (
                runtime.listener_stop.take(),
                runtime.listener_thread.take(),
                runtime.dispatcher_thread.take(),
                runtime.request_tx.take(),
            )
        };
        if let Some(stop) = listener_stop {
            stop.store(true, Ordering::SeqCst);
        }
        if let Some(tx) = request_tx {
            let _ = tx.send(BridgeMessage::Shutdown);
        }
        if let Some(thread) = listener_thread {
            let _ = thread.join();
        }
        if let Ok(mut connections) = self.connections.lock() {
            for (_, stream) in connections.drain() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(BridgeResponse {
                    ok: false,
                    payload: json!({"code":"busy","message":"The MCP bridge was turned off."}),
                });
            }
        }
        if let Some(thread) = dispatcher_thread {
            let _ = thread.join();
        }
        let _ = remove_discovery(&self.discovery_path());
    }

    fn status(&self) -> BridgeStatus {
        self.runtime
            .lock()
            .map(|runtime| BridgeStatus {
                enabled: runtime.enabled,
                port: runtime.port,
            })
            .unwrap_or(BridgeStatus {
                enabled: false,
                port: None,
            })
    }

    fn discovery_path(&self) -> PathBuf {
        self.config_dir.join(DISCOVERY_FILE_NAME)
    }

    fn set_project(&self, root: &Path) {
        let Some(name) = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            return;
        };
        let Ok(mut runtime) = self.runtime.lock() else {
            return;
        };
        runtime.project = Some(ProjectInfo {
            name,
            root: display_path(root),
        });
        if !runtime.enabled {
            return;
        }
        let (Some(port), Some(token)) = (runtime.port, runtime.token.as_ref()) else {
            return;
        };
        let discovery = DiscoveryFile {
            protocol: PROTOCOL_VERSION,
            port,
            token: token.clone(),
            pid: std::process::id(),
            app_version: self.app_version.clone(),
            project: runtime.project.clone(),
        };
        if let Err(error) = write_discovery(&self.discovery_path(), &discovery) {
            eprintln!("Could not update MCP discovery information: {error}");
        }
    }

    fn respond(&self, request_id: String, ok: bool, payload: Value) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .map_err(|_| "MCP pending requests are unavailable")?
            .get(&request_id)
            .cloned()
            .ok_or_else(|| "MCP request has expired or is unknown".to_string())?;
        sender
            .send(BridgeResponse { ok, payload })
            .map_err(|_| "MCP request has expired or is unknown".to_string())
    }
}

#[tauri::command]
pub fn mcp_bridge_set_enabled(
    app: AppHandle,
    state: State<'_, McpBridgeState>,
    enabled: bool,
) -> Result<BridgeStatus, String> {
    if enabled {
        state.enable(app)?;
    } else {
        state.disable();
    }
    Ok(state.status())
}

#[tauri::command]
pub fn mcp_bridge_ready(state: State<'_, McpBridgeState>) -> BridgeStatus {
    let status = state.status();
    state.ready.store(status.enabled, Ordering::SeqCst);
    status
}

#[tauri::command]
pub fn mcp_respond(
    state: State<'_, McpBridgeState>,
    request_id: String,
    ok: bool,
    payload: Value,
) -> Result<(), String> {
    state.respond(request_id, ok, payload)
}

pub fn project_changed(app: &AppHandle, root: &Path) {
    if let Some(state) = app.try_state::<McpBridgeState>() {
        state.set_project(root);
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<McpBridgeState>() {
        state.disable();
    }
}

fn accept_loop(
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    token: String,
    app_version: String,
    request_tx: Sender<BridgeMessage>,
    connections: Arc<Mutex<HashMap<u64, TcpStream>>>,
    next_connection_id: Arc<AtomicU64>,
    next_request_id: Arc<AtomicU64>,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let id = next_connection_id.fetch_add(1, Ordering::Relaxed);
                if let Ok(clone) = stream.try_clone() {
                    if let Ok(mut active) = connections.lock() {
                        active.insert(id, clone);
                    }
                }
                let token = token.clone();
                let app_version = app_version.clone();
                let request_tx = request_tx.clone();
                let connections = Arc::clone(&connections);
                let next_request_id = Arc::clone(&next_request_id);
                let _ = thread::Builder::new()
                    .name(format!("hive-mcp-client-{id}"))
                    .spawn(move || {
                        serve_client(stream, &token, &app_version, request_tx, next_request_id);
                        if let Ok(mut active) = connections.lock() {
                            active.remove(&id);
                        }
                    });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                eprintln!("MCP listener stopped after an accept error: {error}");
                break;
            }
        }
    }
}

fn serve_client(
    mut stream: TcpStream,
    token: &str,
    app_version: &str,
    request_tx: Sender<BridgeMessage>,
    next_request_id: Arc<AtomicU64>,
) {
    // On Windows an accepted socket inherits the listener's non-blocking mode; reads would then
    // fail with WouldBlock (os error 10035) as soon as the client pauses between messages.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(HELLO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HELLO_TIMEOUT));
    let Ok(clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(clone);
    let hello = match read_protocol_line(&mut reader) {
        Ok(Some(line)) => serde_json::from_slice::<Value>(&line),
        Ok(None) | Err(_) => return,
    };
    let hello = match hello {
        Ok(hello) => hello,
        Err(_) => {
            let _ = write_json_line(
                &mut stream,
                &json!({"type":"error","code":"protocol_mismatch","message":"Send a JSON hello message first."}),
            );
            return;
        }
    };
    if let Err((code, message)) = validate_hello(&hello, token) {
        let _ = write_json_line(
            &mut stream,
            &json!({"type":"error","code":code,"message":message}),
        );
        return;
    }
    if write_json_line(
        &mut stream,
        &json!({"type":"welcome","protocol":PROTOCOL_VERSION,"appVersion":app_version}),
    )
    .is_err()
    {
        return;
    }
    let _ = stream.set_read_timeout(None);
    let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));

    loop {
        let line = match read_protocol_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                let _ = write_json_line(
                    &mut stream,
                    &wire_error(Value::Null, "invalid_params", &error.to_string()),
                );
                break;
            }
        };
        let request = match serde_json::from_slice::<Value>(&line) {
            Ok(request) => request,
            Err(_) => {
                if write_json_line(
                    &mut stream,
                    &wire_error(
                        Value::Null,
                        "invalid_params",
                        "Request must be a JSON object.",
                    ),
                )
                .is_err()
                {
                    break;
                }
                continue;
            }
        };
        let Some(method) = request.get("method").and_then(Value::as_str) else {
            if write_json_line(
                &mut stream,
                &wire_error(
                    request.get("id").cloned().unwrap_or(Value::Null),
                    "invalid_params",
                    "Request method must be a string.",
                ),
            )
            .is_err()
            {
                break;
            }
            continue;
        };
        let client_id = request.get("id").cloned().unwrap_or(Value::Null);
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        let request_id = format!(
            "{}-{}",
            std::process::id(),
            next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let (client_reply, client_response) = mpsc::channel();
        let job = RequestJob {
            client_id,
            request_id,
            method: method.to_string(),
            params,
            client_reply,
        };
        if request_tx.send(BridgeMessage::Request(job)).is_err() {
            let _ = write_json_line(
                &mut stream,
                &wire_error(
                    Value::Null,
                    "busy",
                    "The MCP bridge is stopping. Retry after it starts again.",
                ),
            );
            break;
        }
        match client_response.recv() {
            Ok(response) => {
                if write_json_line(&mut stream, &response).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn dispatch_loop(
    app: AppHandle,
    requests: Receiver<BridgeMessage>,
    pending: Arc<Mutex<HashMap<String, SyncSender<BridgeResponse>>>>,
    ready: Arc<AtomicBool>,
) {
    while let Ok(message) = requests.recv() {
        let BridgeMessage::Request(job) = message else {
            break;
        };
        if !ready.load(Ordering::SeqCst) {
            let _ = job.client_reply.send(wire_error(
                job.client_id,
                "busy",
                "hive is still starting. Retry when its window is ready.",
            ));
            continue;
        }
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        if let Ok(mut active) = pending.lock() {
            active.insert(job.request_id.clone(), response_tx);
        } else {
            let _ = job.client_reply.send(wire_error(
                job.client_id,
                "internal",
                "MCP request tracking is unavailable.",
            ));
            continue;
        }
        let event = json!({
            "requestId": &job.request_id,
            "method": &job.method,
            "params": &job.params,
        });
        let emit_result = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is unavailable".to_string())
            .and_then(|window| {
                window
                    .emit("hive://mcp-request", event)
                    .map_err(|error| error.to_string())
            });
        if let Err(error) = emit_result {
            if let Ok(mut active) = pending.lock() {
                active.remove(&job.request_id);
            }
            let _ = job.client_reply.send(wire_error(
                job.client_id,
                "busy",
                &format!("Could not deliver the request to hive: {error}"),
            ));
            continue;
        }
        let response = match wait_for_frontend_reply(&response_rx, REQUEST_TIMEOUT) {
            Ok(response) if response.ok => json!({"id":job.client_id,"result":response.payload}),
            Ok(response) => json!({"id":job.client_id,"error":response.payload}),
            Err(RecvTimeoutError::Timeout) => wire_error(
                job.client_id,
                "timeout",
                "The operation took longer than 30 seconds. Check hive, then retry.",
            ),
            Err(RecvTimeoutError::Disconnected) => wire_error(
                job.client_id,
                "internal",
                "The frontend closed before returning a result. Retry the operation.",
            ),
        };
        if let Ok(mut active) = pending.lock() {
            active.remove(&job.request_id);
        }
        let _ = job.client_reply.send(response);
    }
}

fn wait_for_frontend_reply(
    receiver: &Receiver<BridgeResponse>,
    timeout: Duration,
) -> Result<BridgeResponse, RecvTimeoutError> {
    receiver.recv_timeout(timeout)
}

fn validate_hello(hello: &Value, expected_token: &str) -> Result<(), (&'static str, &'static str)> {
    if hello.get("type").and_then(Value::as_str) != Some("hello") {
        return Err(("protocol_mismatch", "Send a hello message with protocol 1."));
    }
    if hello.get("token").and_then(Value::as_str) != Some(expected_token) {
        return Err((
            "unauthorized",
            "The MCP discovery token is missing or invalid.",
        ));
    }
    if hello.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
        return Err((
            "protocol_mismatch",
            "This MCP client uses a different protocol version.",
        ));
    }
    Ok(())
}

fn read_protocol_line(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    read_protocol_line_with_limit(reader, MAX_LINE_BYTES)
}

fn read_protocol_line_with_limit(
    reader: &mut impl BufRead,
    max_bytes: usize,
) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    let bytes_read = reader
        .take((max_bytes as u64).saturating_add(2))
        .read_until(b'\n', &mut line)?;
    if bytes_read == 0 {
        return Ok(None);
    }
    if line.last() != Some(&b'\n') {
        if line.len() > max_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "MCP line exceeds the 8 MB limit.",
            ));
        }
        // A final partial object is not a newline-delimited protocol message.
        return Ok(None);
    }
    line.pop();
    if line.len() > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MCP line exceeds the 8 MB limit.",
        ));
    }
    Ok(Some(line))
}

fn write_json_line(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    // One write per message: serializing straight into the socket sends dozens of tiny packets.
    let mut line = serde_json::to_vec(value).map_err(io::Error::other)?;
    line.push(b'\n');
    writer.write_all(&line)?;
    writer.flush()
}

/// Path for clients and humans: canonical Windows paths carry the `\\?\` prefix.
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

fn wire_error(id: Value, code: &str, message: &str) -> Value {
    json!({"id":id,"error":{"code":code,"message":message}})
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("could not generate an MCP token: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_discovery(path: &Path, discovery: &DiscoveryFile) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "discovery path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".{DISCOVERY_FILE_NAME}.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(discovery).map_err(io::Error::other)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn remove_discovery(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc;
    use std::time::Instant;

    fn temporary_directory(label: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        std::env::temp_dir().join(format!(
            "hive-mcp-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn hello_handshake_accepts_matching_token_and_protocol() {
        let hello = json!({"type":"hello","token":"aabb","client":"test","protocol":1});
        assert!(validate_hello(&hello, "aabb").is_ok());
    }

    #[test]
    fn hello_handshake_rejects_a_bad_token() {
        let hello = json!({"type":"hello","token":"wrong","protocol":1});
        assert_eq!(
            validate_hello(&hello, "right").unwrap_err().0,
            "unauthorized"
        );
    }

    #[test]
    fn hello_handshake_rejects_a_protocol_mismatch() {
        let hello = json!({"type":"hello","token":"aabb","protocol":2});
        assert_eq!(
            validate_hello(&hello, "aabb").unwrap_err().0,
            "protocol_mismatch"
        );
    }

    #[test]
    fn line_reader_enforces_the_cap_and_accepts_the_limit() {
        let mut exact = Cursor::new(b"abc\n".to_vec());
        assert_eq!(
            read_protocol_line_with_limit(&mut exact, 3).unwrap(),
            Some(b"abc".to_vec())
        );
        let mut too_long = Cursor::new(b"abcd\n".to_vec());
        assert_eq!(
            read_protocol_line_with_limit(&mut too_long, 3)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn frontend_response_timeout_is_reported() {
        let (_keep_sender_alive, receiver) = mpsc::sync_channel(1);
        let started = Instant::now();
        assert_eq!(
            wait_for_frontend_reply(&receiver, Duration::from_millis(10)).unwrap_err(),
            RecvTimeoutError::Timeout
        );
        assert!(started.elapsed() >= Duration::from_millis(8));
    }

    #[test]
    fn discovery_file_is_written_and_removed_for_the_lifecycle() {
        let directory = temporary_directory("discovery");
        let path = directory.join(DISCOVERY_FILE_NAME);
        let discovery = DiscoveryFile {
            protocol: PROTOCOL_VERSION,
            port: 12345,
            token: "ab".repeat(32),
            pid: 9,
            app_version: "1.6.9".to_string(),
            project: Some(ProjectInfo {
                name: "Main".to_string(),
                root: "C:/Main".to_string(),
            }),
        };
        write_discovery(&path, &discovery).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["port"], 12345);
        assert_eq!(saved["project"]["name"], "Main");
        remove_discovery(&path).unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(directory);
    }
}
