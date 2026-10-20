<script lang="ts">
  import Select from "../../ui/Select.svelte";
  import SettingToggle from "../SettingToggle.svelte";
  import { preferences, setRecordInBackground, setVideoExternalThresholdMb } from "../preferences.svelte";
  import { DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB } from "../videoThreshold";
  import { gifPlayback, setGifPlaybackMode } from "../../attachments/gifPlayback.svelte";
  import { t } from "../../i18n/i18n.svelte";

  let videoThresholdDraft = $state(String(preferences.videoExternalThresholdMb ?? DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB));

  function changeVideoThreshold(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    setVideoExternalThresholdMb(event.currentTarget.valueAsNumber);
    videoThresholdDraft = String(preferences.videoExternalThresholdMb ?? DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB);
  }

  function handleVideoThresholdKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      videoThresholdDraft = String(preferences.videoExternalThresholdMb ?? DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB);
      input.blur();
    }
  }

  function toggleUnlimitedVideoThreshold(unlimited: boolean): void {
    if (unlimited) {
      setVideoExternalThresholdMb(null);
      return;
    }
    setVideoExternalThresholdMb(Number(videoThresholdDraft));
    videoThresholdDraft = String(preferences.videoExternalThresholdMb ?? DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB);
  }
</script>

<section class="settings-block" aria-labelledby="playback-settings-title">
  <div class="settings-block-header"><h3 id="playback-settings-title" class="settings-block-title">{t("Images and GIFs")}</h3></div>
  <div class="settings-group">
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("GIF playback")}</span>
        <span class="setting-description">{t("Stopped GIFs stay still until you choose Play gif.")}</span>
      </span>
      <span class="settings-select">
        <Select id="settings-gif-playback" ariaLabel={t("GIF playback")} value={gifPlayback.mode} options={[
          { value: "always", label: t("Always") },
          { value: "hover", label: t("On hover") },
          { value: "selected", label: t("When selected") },
        ]} onchange={setGifPlaybackMode} />
      </span>
    </div>
  </div>
</section>

<section class="settings-block" aria-labelledby="audio-settings-title">
  <div class="settings-block-header"><h3 id="audio-settings-title" class="settings-block-title">{t("Audio")}</h3></div>
  <div class="settings-group">
    <SettingToggle
      label={t("Record in background")}
      description={t("Keep an active audio recording when the window loses focus.")}
      checked={preferences.recordInBackground}
      onchange={setRecordInBackground}
    />
  </div>
</section>

<section class="settings-block" aria-labelledby="video-settings-title" data-video-threshold-setting>
  <div class="settings-block-header"><h3 id="video-settings-title" class="settings-block-title">{t("Video")}</h3></div>
  <div class="settings-group">
    <SettingToggle
      label={t("Always copy videos into the project")}
      description={t("Every video is copied, whatever its size. The project folder can grow large.")}
      checked={preferences.videoExternalThresholdMb === null}
      data-video-threshold-unlimited
      onchange={toggleUnlimitedVideoThreshold}
    />
    <label class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Link large videos instead of copying")}</span>
        <span class="setting-description">{t("Videos above this size stay where they are, so the project folder stays small.")}</span>
      </span>
      <span class="setting-control">
        <input
          id="settings-video-threshold"
          class="settings-input"
          type="number"
          min="1"
          step="1"
          value={videoThresholdDraft}
          disabled={preferences.videoExternalThresholdMb === null}
          data-video-threshold-input
          aria-label={t("Video external storage threshold in megabytes")}
          oninput={(event) => (videoThresholdDraft = event.currentTarget.value)}
          onchange={changeVideoThreshold}
          onkeydown={handleVideoThresholdKeydown}
        />
        <span class="setting-unit">MB</span>
      </span>
    </label>
  </div>
</section>
