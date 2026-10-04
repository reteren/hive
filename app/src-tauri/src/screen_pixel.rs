use tauri::WebviewWindow;

/// Convert a webview client point in logical pixels to a desktop point in physical pixels.
fn client_to_screen_point(
    client_x: f64,
    client_y: f64,
    scale_factor: f64,
    inner_x: i32,
    inner_y: i32,
) -> Option<(i32, i32)> {
    if !client_x.is_finite()
        || !client_y.is_finite()
        || !scale_factor.is_finite()
        || scale_factor <= 0.0
        || client_x < 0.0
        || client_y < 0.0
    {
        return None;
    }

    let x = inner_x as f64 + (client_x * scale_factor).floor();
    let y = inner_y as f64 + (client_y * scale_factor).floor();
    if x < i32::MIN as f64 || x > i32::MAX as f64 || y < i32::MIN as f64 || y > i32::MAX as f64 {
        return None;
    }

    Some((x as i32, y as i32))
}

/// Convert a Win32 COLORREF (0x00BBGGRR) to the CSS hex form used by the brush.
fn colorref_to_hex(colorref: u32) -> String {
    let red = colorref & 0xff;
    let green = (colorref >> 8) & 0xff;
    let blue = (colorref >> 16) & 0xff;
    format!("#{red:02x}{green:02x}{blue:02x}")
}

#[tauri::command]
pub fn sample_screen_pixel(
    window: WebviewWindow,
    client_x: f64,
    client_y: f64,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Ok(None);
    }

    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let physical_x = client_x * scale_factor;
    let physical_y = client_y * scale_factor;
    if !physical_x.is_finite()
        || !physical_y.is_finite()
        || physical_x < 0.0
        || physical_y < 0.0
        || physical_x >= size.width as f64
        || physical_y >= size.height as f64
    {
        return Ok(None);
    }

    let Some((screen_x, screen_y)) = client_to_screen_point(
        client_x,
        client_y,
        scale_factor,
        position.x,
        position.y,
    ) else {
        return Ok(None);
    };

    #[cfg(windows)]
    {
        capture_screen_pixel(screen_x, screen_y).map(Some)
    }
    #[cfg(not(windows))]
    {
        let _ = (screen_x, screen_y);
        Err("Screen pixel sampling is available only on Windows.".to_string())
    }
}

#[cfg(windows)]
fn capture_screen_pixel(x: i32, y: i32) -> Result<String, String> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
        HBITMAP, HGDIOBJ, SRCCOPY,
    };

    unsafe {
        let screen_dc = GetDC(null_mut());
        if screen_dc.is_null() {
            return Err("Could not open the desktop screen DC.".to_string());
        }

        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.is_null() {
            ReleaseDC(null_mut(), screen_dc);
            return Err("Could not create a pixel capture DC.".to_string());
        }

        let bitmap: HBITMAP = CreateCompatibleBitmap(screen_dc, 1, 1);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
            return Err("Could not create a pixel capture bitmap.".to_string());
        }

        let previous_bitmap: HGDIOBJ = SelectObject(memory_dc, bitmap as HGDIOBJ);
        if previous_bitmap.is_null() {
            DeleteObject(bitmap as HGDIOBJ);
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
            return Err("Could not select the pixel capture bitmap.".to_string());
        }

        let copied = BitBlt(
            memory_dc,
            0,
            0,
            1,
            1,
            screen_dc,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        ) != 0;
        SelectObject(memory_dc, previous_bitmap);

        let result = if !copied {
            Err("Could not copy the screen pixel.".to_string())
        } else {
            let mut bitmap_info = BITMAPINFO::default();
            bitmap_info.bmiHeader.biSize = size_of::<windows_sys::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
            bitmap_info.bmiHeader.biWidth = 1;
            // Negative height requests a top-down DIB, so the first row is the captured pixel.
            bitmap_info.bmiHeader.biHeight = -1;
            bitmap_info.bmiHeader.biPlanes = 1;
            bitmap_info.bmiHeader.biBitCount = 32;
            bitmap_info.bmiHeader.biCompression = BI_RGB;

            let mut pixel = [0u8; 4];
            let rows = GetDIBits(
                screen_dc,
                bitmap,
                0,
                1,
                pixel.as_mut_ptr().cast::<c_void>(),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );
            if rows != 1 {
                Err("Could not read the copied screen pixel.".to_string())
            } else {
                let colorref = pixel[2] as u32 | ((pixel[1] as u32) << 8) | ((pixel[0] as u32) << 16);
                Ok(colorref_to_hex(colorref))
            }
        };

        DeleteObject(bitmap as HGDIOBJ);
        DeleteDC(memory_dc);
        ReleaseDC(null_mut(), screen_dc);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{client_to_screen_point, colorref_to_hex};

    #[test]
    fn converts_logical_client_point_using_monitor_scale_and_inner_origin() {
        assert_eq!(
            client_to_screen_point(10.5, 20.1, 1.5, 100, -200),
            Some((115, -170))
        );
    }

    #[test]
    fn rejects_invalid_client_points_and_scale_factors() {
        assert_eq!(client_to_screen_point(-0.1, 2.0, 1.0, 0, 0), None);
        assert_eq!(client_to_screen_point(2.0, f64::NAN, 1.0, 0, 0), None);
        assert_eq!(client_to_screen_point(2.0, 2.0, 0.0, 0, 0), None);
    }

    #[test]
    fn converts_colorref_red_green_blue_byte_order_to_hex() {
        assert_eq!(colorref_to_hex(0x0033_2211), "#112233");
        assert_eq!(colorref_to_hex(0x00ff_0000), "#0000ff");
    }
}
