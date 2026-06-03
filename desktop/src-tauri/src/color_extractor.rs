use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct ColorPalette {
    pub dominant: String,
    pub palette: Vec<String>,
    pub is_dark: bool,
    pub tint_r: u8,
    pub tint_g: u8,
    pub tint_b: u8,
}

pub struct PaletteCache(pub Mutex<HashMap<String, ColorPalette>>);

fn luminance_f(r: u8, g: u8, b: u8) -> f32 {
    let lin = |v: u8| -> f32 {
        let s = v as f32 / 255.0;
        if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

fn colorfulness(p: &[u8; 3]) -> f32 {
    let max = p[0].max(p[1]).max(p[2]) as f32;
    let min = p[0].min(p[1]).min(p[2]) as f32;
    (max - min) / 255.0
}

fn to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

fn bucket_avg(pixels: &[[u8; 3]]) -> [u8; 3] {
    if pixels.is_empty() { return [107, 92, 78]; }
    let n = pixels.len() as u32;
    let r = pixels.iter().map(|p| p[0] as u32).sum::<u32>() / n;
    let g = pixels.iter().map(|p| p[1] as u32).sum::<u32>() / n;
    let b = pixels.iter().map(|p| p[2] as u32).sum::<u32>() / n;
    [r as u8, g as u8, b as u8]
}

fn median_cut(mut pixels: Vec<[u8; 3]>, depth: u8) -> Vec<[u8; 3]> {
    if depth == 0 || pixels.is_empty() {
        return vec![bucket_avg(&pixels)];
    }

    let (mut r_min, mut r_max) = (255u8, 0u8);
    let (mut g_min, mut g_max) = (255u8, 0u8);
    let (mut b_min, mut b_max) = (255u8, 0u8);
    for p in &pixels {
        r_min = r_min.min(p[0]); r_max = r_max.max(p[0]);
        g_min = g_min.min(p[1]); g_max = g_max.max(p[1]);
        b_min = b_min.min(p[2]); b_max = b_max.max(p[2]);
    }

    let ch = if r_max - r_min >= g_max - g_min && r_max - r_min >= b_max - b_min { 0 }
             else if g_max - g_min >= b_max - b_min { 1 }
             else { 2 };

    pixels.sort_unstable_by_key(|p| p[ch]);
    let mid = pixels.len() / 2;
    let right = pixels.split_off(mid);

    let mut result = median_cut(pixels, depth - 1);
    result.extend(median_cut(right, depth - 1));
    result
}

fn extract_palette_from_path(path: &str) -> Result<ColorPalette, String> {
    let img = image::open(path)
        .map_err(|e| format!("cannot open image: {e}"))?
        .resize_exact(80, 80, image::imageops::FilterType::Lanczos3)
        .to_rgb8();

    let pixels: Vec<[u8; 3]> = img
        .pixels()
        .filter_map(|p| {
            let [r, g, b] = p.0;
            let lum = luminance_f(r, g, b);
            if lum > 0.05 && lum < 0.92 { Some([r, g, b]) } else { None }
        })
        .collect();

    if pixels.is_empty() {
        return Ok(ColorPalette {
            dominant: "#6b5c4e".into(),
            palette: vec!["#6b5c4e".into()],
            is_dark: true,
            tint_r: 107, tint_g: 92, tint_b: 78,
        });
    }

    let mut palette = median_cut(pixels, 3);
    palette.sort_unstable_by(|a, b| colorfulness(b).partial_cmp(&colorfulness(a)).unwrap_or(std::cmp::Ordering::Equal));

    let dom = palette[0];
    let is_dark = luminance_f(dom[0], dom[1], dom[2]) < 0.45;

    Ok(ColorPalette {
        dominant: to_hex(dom[0], dom[1], dom[2]),
        palette: palette.iter().map(|p| to_hex(p[0], p[1], p[2])).collect(),
        is_dark,
        tint_r: dom[0],
        tint_g: dom[1],
        tint_b: dom[2],
    })
}

#[tauri::command]
pub async fn get_background_palette(
    path: String,
    cache: State<'_, PaletteCache>,
) -> Result<ColorPalette, String> {
    {
        let guard = cache.0.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = guard.get(&path) {
            return Ok(cached.clone());
        }
    }
    let result = extract_palette_from_path(&path)?;
    cache.0.lock().map_err(|e| e.to_string())?.insert(path, result.clone());
    Ok(result)
}

#[tauri::command]
pub async fn clear_palette_cache(cache: State<'_, PaletteCache>) -> Result<(), String> {
    cache.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}
