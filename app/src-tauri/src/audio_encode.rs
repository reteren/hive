//! Dictaphone output formats. The webview can only record WebM/Opus, so the front end decodes the
//! finished recording to 16-bit PCM and this module encodes it to the format chosen in
//! Settings → Media → Recording format (MP3, Ogg Vorbis, WAV or FLAC).

use std::num::{NonZeroU32, NonZeroU8};

use flacenc::component::BitRepr;
use flacenc::error::Verify;
use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, InterleavedPcm, MonoPcm, Quality};
use tauri::ipc::{InvokeBody, Request, Response};

/// Samples handed to libvorbis per call; the libvorbis docs call 1024 "a reasonable choice".
const VORBIS_BLOCK_FRAMES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordingFormat {
    Mp3,
    Ogg,
    Wav,
    Flac,
}

impl RecordingFormat {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "mp3" => Ok(Self::Mp3),
            "ogg" => Ok(Self::Ogg),
            "wav" => Ok(Self::Wav),
            "flac" => Ok(Self::Flac),
            _ => Err(format!("Unsupported recording format: {value}")),
        }
    }
}

/// Raw body: interleaved little-endian i16 PCM. Headers: x-hive-format, x-hive-rate, x-hive-channels.
#[tauri::command]
pub async fn audio_encode_recording(request: Request<'_>) -> Result<Response, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| format!("The recording is missing {name}."))
    };
    let format = RecordingFormat::parse(&header("x-hive-format")?)?;
    let sample_rate: u32 = header("x-hive-rate")?.parse().map_err(|_| "The sample rate is invalid.".to_string())?;
    let channels: u8 = header("x-hive-channels")?.parse().map_err(|_| "The channel count is invalid.".to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The recorded audio is missing.".to_string());
    };
    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let encoded = tauri::async_runtime::spawn_blocking(move || encode(format, sample_rate, channels, &samples))
        .await
        .map_err(|error| error.to_string())??;
    Ok(Response::new(encoded))
}

pub fn encode(format: RecordingFormat, sample_rate: u32, channels: u8, samples: &[i16]) -> Result<Vec<u8>, String> {
    if !(1..=2).contains(&channels) {
        return Err("Recordings must be mono or stereo.".to_string());
    }
    if sample_rate == 0 || samples.is_empty() || samples.len() % channels as usize != 0 {
        return Err("The recorded audio is empty or damaged.".to_string());
    }
    match format {
        RecordingFormat::Mp3 => encode_mp3(sample_rate, channels, samples),
        RecordingFormat::Ogg => encode_ogg(sample_rate, channels, samples),
        RecordingFormat::Wav => Ok(encode_wav(sample_rate, channels, samples)),
        RecordingFormat::Flac => encode_flac(sample_rate, channels, samples),
    }
}

fn encode_mp3(sample_rate: u32, channels: u8, samples: &[i16]) -> Result<Vec<u8>, String> {
    let fail = |error: &dyn std::fmt::Debug| format!("MP3 encoding failed: {error:?}");
    let mut builder = Builder::new().ok_or("MP3 encoder could not start.")?;
    builder.set_num_channels(channels).map_err(|e| fail(&e))?;
    builder.set_sample_rate(sample_rate).map_err(|e| fail(&e))?;
    builder.set_brate(Bitrate::Kbps128).map_err(|e| fail(&e))?;
    builder.set_quality(Quality::Good).map_err(|e| fail(&e))?;
    let mut encoder = builder.build().map_err(|e| fail(&e))?;
    let frames = samples.len() / channels as usize;
    let mut out = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(frames));
    if channels == 1 {
        encoder.encode_to_vec(MonoPcm(samples), &mut out).map_err(|e| fail(&e))?;
    } else {
        encoder.encode_to_vec(InterleavedPcm(samples), &mut out).map_err(|e| fail(&e))?;
    }
    encoder.flush_to_vec::<FlushNoGap>(&mut out).map_err(|e| fail(&e))?;
    Ok(out)
}

fn encode_ogg(sample_rate: u32, channels: u8, samples: &[i16]) -> Result<Vec<u8>, String> {
    let fail = |error: vorbis_rs::VorbisError| format!("Ogg encoding failed: {error}");
    let rate = NonZeroU32::new(sample_rate).ok_or("The sample rate is invalid.")?;
    let count = NonZeroU8::new(channels).ok_or("The channel count is invalid.")?;
    let mut out = Vec::new();
    let mut encoder = vorbis_rs::VorbisEncoderBuilder::new(rate, count, &mut out)
        .map_err(fail)?
        .build()
        .map_err(fail)?;
    let channels = channels as usize;
    for block in samples.chunks(VORBIS_BLOCK_FRAMES * channels) {
        let planar: Vec<Vec<f32>> = (0..channels)
            .map(|channel| block.iter().skip(channel).step_by(channels).map(|&s| s as f32 / 32768.0).collect())
            .collect();
        encoder.encode_audio_block(&planar).map_err(fail)?;
    }
    encoder.finish().map_err(fail)?;
    Ok(out)
}

fn encode_wav(sample_rate: u32, channels: u8, samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let block_align = channels as u16 * 2;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&(channels as u16).to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * block_align as u32).to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

fn encode_flac(sample_rate: u32, channels: u8, samples: &[i16]) -> Result<Vec<u8>, String> {
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|(_, error)| format!("FLAC encoder setup failed: {error:?}"))?;
    let ints: Vec<i32> = samples.iter().map(|&s| s as i32).collect();
    let source = flacenc::source::MemSource::from_samples(&ints, channels as usize, 16, sample_rate as usize);
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|error| format!("FLAC encoding failed: {error:?}"))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream.write(&mut sink).map_err(|error| format!("FLAC encoding failed: {error:?}"))?;
    Ok(sink.as_slice().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(channels: u8) -> Vec<i16> {
        (0..48_000 * channels as usize)
            .map(|i| (((i / channels as usize) as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 9000.0) as i16)
            .collect()
    }

    #[test]
    fn every_format_has_its_signature() {
        for channels in [1, 2] {
            let pcm = tone(channels);
            let mp3 = encode(RecordingFormat::Mp3, 48_000, channels, &pcm).unwrap();
            assert!(mp3[0] == 0xFF && mp3[1] & 0xE0 == 0xE0, "MP3 frame sync");
            assert!(encode(RecordingFormat::Ogg, 48_000, channels, &pcm).unwrap().starts_with(b"OggS"));
            assert!(encode(RecordingFormat::Flac, 48_000, channels, &pcm).unwrap().starts_with(b"fLaC"));
            let wav = encode(RecordingFormat::Wav, 48_000, channels, &pcm).unwrap();
            assert!(wav.starts_with(b"RIFF") && &wav[8..12] == b"WAVE");
            assert_eq!(wav.len(), 44 + pcm.len() * 2);
        }
    }

    #[test]
    fn rejects_bad_input() {
        assert!(encode(RecordingFormat::Wav, 48_000, 3, &[0; 6]).is_err());
        assert!(encode(RecordingFormat::Mp3, 48_000, 2, &[0; 3]).is_err());
        assert!(encode(RecordingFormat::Flac, 48_000, 1, &[]).is_err());
        assert!(RecordingFormat::parse("aac").is_err());
    }
}
