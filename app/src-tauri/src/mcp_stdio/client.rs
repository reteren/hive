//! Client side of hive's local MCP bridge (see mcp_bridge.rs): newline-delimited JSON over
//! 127.0.0.1 with a token handshake. Used by `hive.exe mcp`, the stdio MCP server built into hive.
//! Reconnects lazily: every call re-reads the discovery file when there is no live connection, so
//! restarting hive or switching projects needs no MCP restart.

use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const PROTOCOL_VERSION: u64 = 1;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(40);

pub const NOT_RUNNING_MESSAGE: &str =
    "hive is not running (or 'Allow AI tools (MCP)' is off in hive Settings). Start hive and open the project, then retry.";

/// An error from hive, or from this client when hive cannot be reached.
#[derive(Debug, Clone)]
pub struct HiveError {
    pub code: String,
    pub message: String,
    pub data: Option<Value>,
}

impl HiveError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into(), data: None }
    }

    pub fn not_running() -> Self {
        Self::new("not_running", NOT_RUNNING_MESSAGE)
    }

    pub fn is_not_running(&self) -> bool {
        self.code == "not_running"
    }
}

#[derive(Debug, Clone)]
pub struct BridgeInfo {
    pub protocol: u64,
    pub port: u16,
    pub token: String,
    pub app_version: String,
    pub project_root: Option<String>,
}

/// Tauri canonical paths may carry the Windows extended-length prefix `\\?\`.
pub fn strip_extended_prefix(value: &str) -> String {
    value.strip_prefix(r"\\?\").unwrap_or(value).to_string()
}

pub fn read_bridge_info(config_dir: &Path) -> Option<BridgeInfo> {
    let raw = fs::read_to_string(config_dir.join("mcp-bridge.json")).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let port = u16::try_from(value.get("port")?.as_u64()?).ok()?;
    let token = value.get("token")?.as_str()?.to_string();
    Some(BridgeInfo {
        protocol: value.get("protocol").and_then(Value::as_u64).unwrap_or(0),
        port,
        token,
        app_version: value.get("appVersion").and_then(Value::as_str).unwrap_or("unknown").to_string(),
        project_root: value
            .get("project")
            .and_then(|project| project.get("root"))
            .and_then(Value::as_str)
            .map(strip_extended_prefix),
    })
}

/// The project hive opened last (read-only access while hive is closed).
pub fn read_last_project_root(config_dir: &Path) -> Option<String> {
    if let Ok(dir) = std::env::var("HIVE_PROJECT_DIR") {
        if !dir.is_empty() {
            return Some(dir);
        }
    }
    let raw = fs::read_to_string(config_dir.join("last-project.json")).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value.as_str().filter(|path| !path.is_empty()).map(strip_extended_prefix)
}

struct Connection {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

pub struct HiveBridge {
    config_dir: PathBuf,
    client_name: String,
    connection: Option<Connection>,
    next_id: u64,
    pub info: Option<BridgeInfo>,
}

impl HiveBridge {
    pub fn new(config_dir: PathBuf, client_name: String) -> Self {
        Self { config_dir, client_name, connection: None, next_id: 1, info: None }
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, HiveError> {
        // One retry: a stale connection (hive restarted) fails on first use.
        for attempt in 0..2 {
            if self.connection.is_none() {
                self.connection = Some(self.open()?);
            }
            match self.request(method, &params) {
                Ok(value) => return value,
                Err(_) if attempt == 0 => {
                    self.connection = None;
                }
                Err(error) => {
                    self.connection = None;
                    return Err(error);
                }
            }
        }
        Err(HiveError::not_running())
    }

    /// Ok(Ok/Err) = hive answered; Err = the connection broke.
    fn request(&mut self, method: &str, params: &Value) -> Result<Result<Value, HiveError>, HiveError> {
        let id = self.next_id;
        self.next_id += 1;
        let connection = self.connection.as_mut().ok_or_else(HiveError::not_running)?;
        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        connection.writer.write_all(line.as_bytes()).map_err(|_| HiveError::not_running())?;
        connection.writer.flush().map_err(|_| HiveError::not_running())?;
        loop {
            let mut buffer = String::new();
            match connection.reader.read_line(&mut buffer) {
                Ok(0) => {
                    return Err(HiveError::new(
                        "not_running",
                        "The connection to hive closed before it answered. If hive quit, start it and retry.",
                    ))
                }
                Ok(_) => {}
                Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                    return Ok(Err(HiveError::new(
                        "timeout",
                        format!("hive did not answer {method} within {} s.", REQUEST_TIMEOUT.as_secs()),
                    )))
                }
                Err(_) => return Err(HiveError::not_running()),
            }
            let Ok(message) = serde_json::from_str::<Value>(buffer.trim()) else { continue };
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                return Ok(Err(HiveError {
                    code: error.get("code").and_then(Value::as_str).unwrap_or("internal").to_string(),
                    message: error.get("message").and_then(Value::as_str).unwrap_or("hive reported an error.").to_string(),
                    data: error.get("data").cloned(),
                }));
            }
            return Ok(Ok(message.get("result").cloned().unwrap_or(Value::Null)));
        }
    }

    fn open(&mut self) -> Result<Connection, HiveError> {
        let info = read_bridge_info(&self.config_dir).ok_or_else(HiveError::not_running)?;
        if info.protocol != PROTOCOL_VERSION {
            return Err(HiveError::new(
                "protocol_mismatch",
                format!(
                    "hive {} speaks bridge protocol {}, this server speaks {PROTOCOL_VERSION}. Update hive.",
                    info.app_version, info.protocol
                ),
            ));
        }
        let address = SocketAddr::from(([127, 0, 0, 1], info.port));
        let stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|_| HiveError::not_running())?;
        let _ = stream.set_nodelay(true);
        stream.set_read_timeout(Some(CONNECT_TIMEOUT)).map_err(|_| HiveError::not_running())?;
        let mut writer = stream.try_clone().map_err(|_| HiveError::not_running())?;
        let mut reader = BufReader::new(stream);
        let hello = json!({
            "type": "hello",
            "token": info.token,
            "client": self.client_name,
            "protocol": PROTOCOL_VERSION,
        })
        .to_string()
            + "\n";
        writer.write_all(hello.as_bytes()).map_err(|_| HiveError::not_running())?;
        let mut answer = String::new();
        if reader.read_line(&mut answer).unwrap_or(0) == 0 {
            return Err(HiveError::not_running());
        }
        let message: Value = serde_json::from_str(answer.trim())
            .map_err(|_| HiveError::new("internal", "hive sent an unreadable handshake."))?;
        if message.get("type").and_then(Value::as_str) != Some("welcome") {
            return Err(HiveError::new(
                message.get("code").and_then(Value::as_str).unwrap_or("unauthorized"),
                message.get("message").and_then(Value::as_str).unwrap_or("hive refused the connection."),
            ));
        }
        reader
            .get_ref()
            .set_read_timeout(Some(REQUEST_TIMEOUT))
            .map_err(|_| HiveError::not_running())?;
        self.info = Some(info);
        Ok(Connection { reader, writer })
    }
}
