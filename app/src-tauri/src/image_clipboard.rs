//! "Copy to clipboard" for image and GIF nodes. The clipboard gets a copy of the original file (pasting
//! into Explorer, Discord or Telegram sends the real file, so a GIF stays animated) and the picture
//! itself as PNG and as a bitmap (paint programs, Word, browsers).

use std::io::Cursor;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::attachments::{ensure_attachment_directory, validate_attachment_filename};
use crate::project::{self, ProjectState};

/// Headers: `x-hive-file` (attachment file name), `x-hive-name` (node name, URI-encoded).
/// Body: the picture encoded as PNG (the first frame of a GIF).
#[tauri::command]
pub async fn image_copy_to_clipboard(
    request: Request<'_>,
    state: State<'_, ProjectState>,
) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let file = header("x-hive-file").ok_or("The attachment is missing.")?;
    validate_attachment_filename(&file)?;
    let name = header("x-hive-name").map(|name| percent_decode(&name)).unwrap_or_default();
    let InvokeBody::Raw(png) = request.body() else {
        return Err("The picture is missing.".to_string());
    };

    let root = project::active_project_root(&state)?;
    let source = ensure_attachment_directory(&root)?.join(&file);
    if !source.is_file() {
        return Err("The image file is missing.".to_string());
    }
    let copy = clipboard_file_copy(&source, &name)?;
    let dib = png_to_dib(png)?;
    write_clipboard(&copy, png, &dib)
}

/// A copy named after the node in a temp folder, so the pasted file is not called by its hash.
fn clipboard_file_copy(source: &Path, name: &str) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("hive-clipboard");
    // Only the latest copy is kept; an older one may still be pasted from elsewhere, so errors are ignored.
    if let Ok(entries) = std::fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    std::fs::create_dir_all(&directory).map_err(|error| format!("could not prepare the copy: {error}"))?;
    let stem: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .chars()
        .take(120)
        .collect();
    let stem = if stem.is_empty() { "image".to_string() } else { stem };
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("png");
    let target = directory.join(format!("{stem}.{extension}"));
    std::fs::copy(source, &target).map_err(|error| format!("could not prepare the copy: {error}"))?;
    Ok(target)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A bottom-up 32-bit BITMAPINFOHEADER bitmap. Transparent pixels are blended onto white, because
/// most programs that read a bitmap ignore its alpha (the PNG format keeps the real transparency).
fn png_to_dib(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().map_err(|error| format!("could not read the picture: {error}"))?;
    let size = reader.output_buffer_size().ok_or("The picture is too large.")?;
    let mut pixels = vec![0u8; size];
    let info = reader.next_frame(&mut pixels).map_err(|error| format!("could not read the picture: {error}"))?;
    let (width, height) = (info.width as usize, info.height as usize);
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err("Unexpected palette picture.".to_string()),
    };

    let mut dib = Vec::with_capacity(40 + width * height * 4);
    dib.extend_from_slice(&40u32.to_le_bytes());
    dib.extend_from_slice(&(width as i32).to_le_bytes());
    dib.extend_from_slice(&(height as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&32u16.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    dib.extend_from_slice(&((width * height * 4) as u32).to_le_bytes());
    dib.extend_from_slice(&[0u8; 16]);
    for row in (0..height).rev() {
        let line = &pixels[row * info.line_size..row * info.line_size + width * channels];
        for pixel in line.chunks_exact(channels) {
            let (r, g, b, a) = match channels {
                1 => (pixel[0], pixel[0], pixel[0], 255),
                2 => (pixel[0], pixel[0], pixel[0], pixel[1]),
                3 => (pixel[0], pixel[1], pixel[2], 255),
                _ => (pixel[0], pixel[1], pixel[2], pixel[3]),
            };
            let over_white = |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8;
            dib.extend_from_slice(&[over_white(b), over_white(g), over_white(r), 255]);
        }
    }
    Ok(dib)
}

#[cfg(windows)]
fn write_clipboard(file: &Path, png: &[u8], dib: &[u8]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::{CF_DIB, CF_HDROP};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // DROPFILES { pFiles, pt.x, pt.y, fNC, fWide } followed by a double-NUL-terminated wide path list.
    let mut drop = Vec::new();
    for value in [20u32, 0, 0, 0, 1] {
        drop.extend_from_slice(&value.to_le_bytes());
    }
    for unit in file.as_os_str().encode_wide().chain([0, 0]) {
        drop.extend_from_slice(&unit.to_le_bytes());
    }
    // Explorer pastes it as a copy, not a move.
    let drop_effect = 1u32.to_le_bytes();

    unsafe {
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return Err("The clipboard is busy. Try again.".to_string());
        }
        let result = (|| {
            if EmptyClipboard() == 0 {
                return Err("Could not clear the clipboard.".to_string());
            }
            let put = |format: u32, bytes: &[u8]| -> Result<(), String> {
                let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
                if memory.is_null() {
                    return Err("Not enough memory for the clipboard.".to_string());
                }
                let target = GlobalLock(memory) as *mut u8;
                if target.is_null() {
                    GlobalFree(memory);
                    return Err("Not enough memory for the clipboard.".to_string());
                }
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
                GlobalUnlock(memory);
                // On success the clipboard owns the memory.
                if SetClipboardData(format, memory).is_null() {
                    GlobalFree(memory);
                    return Err("Could not write to the clipboard.".to_string());
                }
                Ok(())
            };
            put(CF_HDROP as u32, &drop)?;
            put(RegisterClipboardFormatW(wide("Preferred DropEffect").as_ptr()), &drop_effect)?;
            put(RegisterClipboardFormatW(wide("PNG").as_ptr()), png)?;
            put(CF_DIB as u32, dib)
        })();
        CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
fn write_clipboard(_file: &Path, _png: &[u8], _dib: &[u8]) -> Result<(), String> {
    Err("Copying pictures is only supported on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(percent_decode("%D0%BA%D0%BE%D1%82%20cat"), "кот cat");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn dib_is_bottom_up_bgra_over_white() {
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[255, 0, 0, 255, 0, 0, 0, 0]).unwrap();
        }
        let dib = png_to_dib(&png_bytes).unwrap();
        assert_eq!(dib.len(), 40 + 8);
        // Bottom row (transparent) first, blended to white; then the red top row as BGRA.
        assert_eq!(&dib[40..44], &[255, 255, 255, 255]);
        assert_eq!(&dib[44..48], &[0, 0, 255, 255]);
    }
}
