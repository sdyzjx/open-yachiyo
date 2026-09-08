# Waveshare ESP32-S3 AMOLED V2 ATRI Firmware

This package contains the validated, filtered OpenLive2D ATRI firmware for the **Waveshare ESP32-S3-Touch-AMOLED-1.8 V2** board.

- Target: ESP32-S3
- Board revision: V2
- Display: CO5300 AMOLED, landscape 448 x 368
- Touch: CST820/CST816S-compatible interface
- Flash: 16 MB, DIO, 80 MHz
- PSRAM: 8 MB Octal
- Build: ESP-IDF 5.5.5
- esptool used for packaging: 4.12.0

Do not flash this bundle to the V1 SH8601 + FT3168 board.

---

## Files

| File | Offset | Purpose |
|---|---:|---|
| `openlive2d-atri-v2-complete.bin` | `0x0000` | Merged image for the simplest full-device flash |
| `bootloader.bin` | `0x0000` | ESP32-S3 bootloader |
| `partition-table.bin` | `0x8000` | Application partition table |
| `openlive2d-atri-v2.bin` | `0x10000` | Filtered ATRI application image |
| `flasher_args.json` | - | Machine-readable flash settings and offsets |
| `SHA256SUMS` | - | Integrity checksums |

The application image is the same build used for the 2026-09-07 device validation. No ELF file, debug symbols, source tree, API key, Wi-Fi credential, or device secret is included.

---

## Verify

macOS:

```bash
shasum -a 256 -c SHA256SUMS
```

Linux:

```bash
sha256sum -c SHA256SUMS
```

PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 *.bin
```

---

## Flash the Merged Image

```bash
python -m pip install esptool
python -m esptool --chip esp32s3 \
  --port /dev/cu.usbmodemXXXX --baud 921600 \
  --before default_reset --after hard_reset \
  write_flash --flash_mode dio --flash_freq 80m --flash_size 16MB \
  0x0 openlive2d-atri-v2-complete.bin
```

Use `/dev/ttyACM*` on Linux or `COMx` on Windows.

---

## Flash Separate Images

```bash
python -m esptool --chip esp32s3 \
  --port /dev/cu.usbmodemXXXX --baud 921600 \
  --before default_reset --after hard_reset \
  write_flash --flash_mode dio --flash_freq 80m --flash_size 16MB \
  0x0000 bootloader.bin \
  0x8000 partition-table.bin \
  0x10000 openlive2d-atri-v2.bin
```

If automatic download mode fails, hold **BOOT**, press and release **RESET**, then release **BOOT** and retry.

Erase old partition data when changing from an unrelated firmware layout:

```bash
python -m esptool --chip esp32s3 \
  --port /dev/cu.usbmodemXXXX erase_flash
```

---

## Startup Check

Use a serial monitor at 115200 baud and verify:

1. PSRAM initialization succeeds.
2. Model validation and creation succeed.
3. The RGB565+A8 sampling cache is created.
4. CPU0 raster and LCD submission tasks start.
5. CPU1 produces the first real-time frame.
6. The character stays idle until touch or BOOT input.
7. Touch or BOOT advances through the available actions.

The binary contains the runtime and ATRI character payload required for the demonstration. Confirm the redistribution terms of embedded third-party components before publishing it in an upstream release.
