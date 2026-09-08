# Embedded Contribution History

This page records the embedded and low-cost hardware work associated with Open Yachiyo. Dates identify when design or validation work occurred. This record was reconstructed on 2026-09-08 from contemporary project material and contributor confirmation; it does not claim that this Markdown file existed on GitHub at the earlier dates.

---

## 2026-02: Early Real-Time Interaction Design

Howtion contributed to the early design of user-friendly, real-time voice interaction on low-cost hardware:

- keep Agent, ASR, and TTS workloads on a host or server
- send compact action, expression, gaze, and lip-control events to the endpoint
- preserve local idle, blink, and touch feedback during network interruption
- decouple audio playback, lip control, and character motion through events
- keep a common endpoint contract for MCUs, desktop pets, and dedicated displays

The original local Git objects were lost after a computer replacement. The reconstructed history commit therefore uses the original contribution period as its author date and the actual reconstruction date as its committer date. This keeps the work period distinct from the date the record entered the current repository.

---

## 2026-09: ESP32-S3 Hardware Validation

The real-time Live2D path was validated on a Waveshare ESP32-S3-Touch-AMOLED-1.8 V2:

- per-frame `.moc3` evaluation without video or image-sequence baking
- RGB565+A8 texture storage and fixed-point software rasterization
- dual-core half-screen raster work, asynchronous LCD DMA, and PSRAM buffering
- integer-filtered expansion from 224 x 184 to landscape 448 x 368
- touch and BOOT-button action selection with idle behavior when untouched
- about 6.9 FPS on the filtered build

The published directory documents the board, flash process, architecture, measurements, and porting boundary. OpenLive2DSDK source and its private build system remain outside the repository.
