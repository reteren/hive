//! WebView2 asks "Allow this app to see text and images copied to the clipboard?" the first time
//! hive reads the clipboard (paste of images, Paste as Plain Text). hive is a local app that only
//! loads its own pages, so the clipboard permission is granted up front for its windows.

/// Grant clipboard reads in this window without the WebView2 prompt.
pub fn allow_clipboard_reads(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let label = window.label().to_string();
        if let Err(error) = window.with_webview(move |webview| {
            if let Err(error) = register(webview.controller()) {
                eprintln!("Could not pre-allow clipboard access in window {label}: {error}");
            }
        }) {
            eprintln!("Could not reach the WebView2 controller: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
fn register(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
        PermissionRequestedEventHandler,
    };

    let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else { return Ok(()) };
        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
        unsafe { args.PermissionKind(&mut kind)? };
        if kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
            unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
        }
        Ok(())
    }));
    let mut token = 0_i64;
    unsafe {
        let webview = controller.CoreWebView2()?;
        webview.add_PermissionRequested(&handler, &mut token)
    }
}
