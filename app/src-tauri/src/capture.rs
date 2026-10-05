const UNSUPPORTED_HIDDEN: &str = "unsupported: Open the hive window to capture the board.";
const MAX_PNG_BYTES: usize = 32 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

fn hidden_window_error(is_visible: bool, is_minimized: bool) -> Option<&'static str> {
    (!is_visible || is_minimized).then_some(UNSUPPORTED_HIDDEN)
}

#[tauri::command]
pub async fn capture_board_preview(window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    let visible = window
        .is_visible()
        .map_err(|_| "internal: Could not check whether the hive window is visible.".to_string())?;
    let minimized = window.is_minimized().map_err(|_| {
        "internal: Could not check whether the hive window is minimized.".to_string()
    })?;
    if let Some(message) = hidden_window_error(visible, minimized) {
        return Err(message.to_string());
    }

    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .with_webview(move |webview| {
                let result = capture_webview(webview.controller());
                let _ = sender.send(result);
            })
            .map_err(|_| "internal: Could not access the hive WebView2 controller.".to_string())?;
        return receiver
            .recv_timeout(std::time::Duration::from_secs(20))
            .map_err(|_| {
                "internal: WebView2 did not finish capturing the board preview.".to_string()
            })?;
    }

    #[cfg(not(windows))]
    {
        Err("unsupported: Board capture is available on Windows only.".to_string())
    }
}

fn validate_png(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_PNG_BYTES {
        return Err("The board preview exceeds the 32 MiB capture limit.");
    }
    if bytes.len() < 24 || bytes.get(..8) != Some(PNG_SIGNATURE.as_slice()) {
        return Err("WebView2 returned an invalid PNG preview.");
    }
    let width = u32::from_be_bytes(
        bytes[16..20]
            .try_into()
            .expect("validated PNG header length"),
    );
    let height = u32::from_be_bytes(
        bytes[20..24]
            .try_into()
            .expect("validated PNG header length"),
    );
    if width == 0 || height == 0 {
        return Err("WebView2 returned an empty PNG preview.");
    }
    Ok(())
}

#[cfg(windows)]
fn capture_webview(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> Result<Vec<u8>, String> {
    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::Com::StructuredStorage::CreateStreamOnHGlobal,
        System::Com::{STATFLAG_DEFAULT, STATSTG, STREAM_SEEK_SET},
    };

    let webview = unsafe { controller.CoreWebView2() }
        .map_err(|_| "internal: Could not access the hive WebView2 content.".to_string())?;
    let stream = unsafe { CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true) }
        .map_err(|_| "internal: Could not create a PNG capture stream.".to_string())?;
    let capture_stream = stream.clone();

    CapturePreviewCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            webview
                .CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                    &capture_stream,
                    &handler,
                )
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(|error_code| error_code),
    )
    .map_err(|_| "internal: WebView2 failed to capture the board preview.".to_string())?;

    let mut stat = STATSTG::default();
    unsafe { stream.Stat(&mut stat, STATFLAG_DEFAULT) }
        .map_err(|_| "internal: Could not read the PNG capture stream size.".to_string())?;
    let size = usize::try_from(stat.cbSize)
        .map_err(|_| "internal: The PNG capture stream size is invalid.".to_string())?;
    if size == 0 || size > MAX_PNG_BYTES {
        return Err("internal: The board preview exceeds the 32 MiB capture limit.".to_string());
    }

    unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }
        .map_err(|_| "internal: Could not rewind the PNG capture stream.".to_string())?;
    let mut bytes = vec![0; size];
    let mut read = 0_u32;
    unsafe { stream.Read(bytes.as_mut_ptr().cast(), size as u32, Some(&mut read)) }
        .ok()
        .map_err(|_| "internal: Could not read the PNG capture stream.".to_string())?;
    if read as usize != size {
        return Err("internal: WebView2 returned an incomplete PNG preview.".to_string());
    }
    validate_png(&bytes).map_err(|message| format!("internal: {message}"))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        hidden_window_error, validate_png, MAX_PNG_BYTES, PNG_SIGNATURE, UNSUPPORTED_HIDDEN,
    };

    #[test]
    fn reports_hidden_or_minimized_window_as_unsupported() {
        assert_eq!(
            UNSUPPORTED_HIDDEN,
            "unsupported: Open the hive window to capture the board."
        );
        assert_eq!(hidden_window_error(false, false), Some(UNSUPPORTED_HIDDEN));
        assert_eq!(hidden_window_error(true, true), Some(UNSUPPORTED_HIDDEN));
        assert_eq!(hidden_window_error(true, false), None);
    }

    #[test]
    fn rejects_empty_or_non_png_capture_data() {
        assert_eq!(
            validate_png(&[]),
            Err("WebView2 returned an invalid PNG preview.")
        );
        let mut bytes = vec![0; 24];
        assert_eq!(
            validate_png(&bytes),
            Err("WebView2 returned an invalid PNG preview.")
        );
        bytes[..8].copy_from_slice(&PNG_SIGNATURE);
        assert_eq!(
            validate_png(&bytes),
            Err("WebView2 returned an empty PNG preview.")
        );
    }

    #[test]
    fn accepts_png_header_and_rejects_oversized_capture() {
        let mut bytes = vec![0; 24];
        bytes[..8].copy_from_slice(&PNG_SIGNATURE);
        bytes[16..20].copy_from_slice(&640_u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&480_u32.to_be_bytes());
        assert_eq!(validate_png(&bytes), Ok(()));
        assert_eq!(
            validate_png(&vec![0; MAX_PNG_BYTES + 1]),
            Err("The board preview exceeds the 32 MiB capture limit.")
        );
    }
}
