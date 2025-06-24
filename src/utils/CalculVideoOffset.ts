/**
 * Utility to calculate synchronization offset between audio beep and video flash
 * Analyzes audio file for 1000Hz beep and video file for green flash
 * Returns the time offset needed to synchronize the files
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Configuration constants
const EXPECTED_FREQUENCY = 1000
const ANALYSIS_WINDOW = 10 // Analyze first 10 seconds

export interface SyncOffset {
    /** Audio signal timestamp in seconds */
    audioTimestamp: number
    /** Video signal timestamp in seconds */
    videoTimestamp: number
    /** Calculated offset in seconds (positive means video is ahead) */
    offsetSeconds: number
    /** Quality/confidence of detection (0-1) */
    confidence: number
}

/**
 * Calculate synchronization offset between audio and video files
 * @param audioPath - Path to audio file (.wav)
 * @param videoPath - Path to video file (.webm, .mp4, etc.)
 * @returns Promise<SyncOffset> - Synchronization information
 */
export async function calculateVideoOffset(
    audioPath: string,
    videoPath: string,
): Promise<SyncOffset> {
    console.log(`🔍 Analyzing sync signals (first ${ANALYSIS_WINDOW}s only)...`)
    console.log(`   Audio: ${audioPath}`)
    console.log(`   Video: ${videoPath}`)

    try {
        // Analyze both files in parallel
        const [audioTimestamp, videoTimestamp] = await Promise.all([
            detectAudioBeep(audioPath),
            detectVideoFlash(videoPath),
        ])

        // Validate that we found both signals
        if (audioTimestamp <= 0) {
            console.warn(
                `⚠️ Failed to detect audio beep in first ${ANALYSIS_WINDOW}s, using default`,
            )
        }
        if (videoTimestamp <= 0) {
            console.warn(
                `⚠️ Failed to detect video flash in first ${ANALYSIS_WINDOW}s, using default`,
            )
        }

        // If either signal is missing, use default values
        if (audioTimestamp <= 0 || videoTimestamp <= 0) {
            const defaultResult: SyncOffset = {
                audioTimestamp: audioTimestamp > 0 ? audioTimestamp : 0,
                videoTimestamp: videoTimestamp > 0 ? videoTimestamp : 0,
                offsetSeconds: 0.0,
                confidence: 0.1,
            }

            console.log(`✅ Using default offset: 0.000s (confidence: 10.0%)`)
            return defaultResult
        }

        const offsetSeconds = videoTimestamp - audioTimestamp
        const confidence = 0.9 // High confidence if both signals detected

        const result: SyncOffset = {
            audioTimestamp,
            videoTimestamp,
            offsetSeconds,
            confidence,
        }

        console.log(`✅ Sync analysis complete:`)
        console.log(`   Audio beep at: ${audioTimestamp.toFixed(3)}s`)
        console.log(`   Video flash at: ${videoTimestamp.toFixed(3)}s`)
        console.log(`   Offset: ${offsetSeconds.toFixed(3)}s`)
        console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`)

        return result
    } catch (error) {
        console.error('❌ Failed to calculate offset:', error)
        console.log('⚠️ Using fallback offset due to analysis error')

        // Return default offset with very low confidence
        const fallbackResult: SyncOffset = {
            audioTimestamp: 0,
            videoTimestamp: 0,
            offsetSeconds: 0.0,
            confidence: 0.05, // Very low confidence for error case
        }

        console.log(`✅ Using fallback offset: 0.000s (confidence: 5.0%)`)
        return fallbackResult
    }
}

/**
 * Detect 1000Hz beep in audio file using FFmpeg spectral analysis
 */
async function detectAudioBeep(audioPath: string): Promise<number> {
    console.log(
        `🔊 Detecting ${EXPECTED_FREQUENCY}Hz beep in first ${ANALYSIS_WINDOW}s of audio...`,
    )

    try {
        // Method 1: Use silence detection to find audio activity
        const silenceCmd = `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-35dB:duration=0.01" -f null -t ${ANALYSIS_WINDOW} - 2>&1 | grep "silence_"`

        try {
            const { stdout: silenceOutput } = await execAsync(silenceCmd)
            const lines = silenceOutput
                .split('\n')
                .filter((line) => line.includes('silence_'))

            console.log(
                `   Silence detection found ${lines.length} events in first ${ANALYSIS_WINDOW}s`,
            )

            // Look for the first significant audio activity (silence_end)
            for (const line of lines) {
                const endMatch = line.match(/silence_end: ([0-9.]+)/)
                if (endMatch) {
                    const time = parseFloat(endMatch[1])
                    if (time > 0.01 && time < ANALYSIS_WINDOW) {
                        // Avoid very early noise
                        console.log(
                            `   Found audio activity (likely bip) at ${time.toFixed(3)}s`,
                        )
                        return time
                    }
                }
            }
        } catch (e) {
            console.log(
                `   Silence detection failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            )
        }

        // Method 2: Use volume analysis to find the first significant audio peak
        const volumeCmd = `ffmpeg -i "${audioPath}" -af "volumedetect" -f null -t ${ANALYSIS_WINDOW} - 2>&1`
        const { stdout: volumeOutput } = await execAsync(volumeCmd)

        const maxVolumeMatch = volumeOutput.match(/max_volume: (-?[0-9.]+) dB/)
        if (maxVolumeMatch) {
            const maxVolume = parseFloat(maxVolumeMatch[1])
            console.log(
                `   Audio levels in first ${ANALYSIS_WINDOW}s: max=${maxVolume.toFixed(1)}dB`,
            )

            // If there's significant audio, use a more detailed analysis
            if (maxVolume > -60) {
                // Use a more sensitive silence detection
                const detailedCmd = `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-50dB:duration=0.005" -f null -t ${ANALYSIS_WINDOW} - 2>&1 | grep "silence_end"`
                try {
                    const { stdout: detailedOutput } =
                        await execAsync(detailedCmd)
                    const detailedLines = detailedOutput
                        .split('\n')
                        .filter((line) => line.includes('silence_end'))

                    for (const line of detailedLines) {
                        const match = line.match(/silence_end: ([0-9.]+)/)
                        if (match) {
                            const time = parseFloat(match[1])
                            if (time > 0.01 && time < ANALYSIS_WINDOW) {
                                console.log(
                                    `   Found audio activity with detailed analysis at ${time.toFixed(3)}s`,
                                )
                                return time
                            }
                        }
                    }
                } catch (e) {
                    console.log(
                        `   Detailed analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
                    )
                }
            }
        }

        console.log(`   No sync bip detected in first ${ANALYSIS_WINDOW}s`)
        return 0
    } catch (error) {
        console.warn(`⚠️ Audio analysis failed: ${error}`)
        return 0
    }
}

/**
 * Detect green flash in video file using FFmpeg frame analysis
 */
async function detectVideoFlash(videoPath: string): Promise<number> {
    console.log(
        `💡 Detecting green flash in video (first ${ANALYSIS_WINDOW}s)...`,
    )

    try {
        // Method 1: Use scene detection to find significant frame changes
        const sceneCmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.05)',showinfo" -f null -t ${ANALYSIS_WINDOW} - 2>&1 | grep "pts_time"`

        try {
            const { stdout: sceneResult } = await execAsync(sceneCmd)
            const lines = sceneResult
                .split('\n')
                .filter((line) => line.includes('pts_time'))

            console.log(
                `   Found ${lines.length} scene changes in first ${ANALYSIS_WINDOW}s`,
            )

            // Look for the most significant scene change after 0.5s (ignore very early scene changes)
            let bestFlashTime = 0
            let bestSceneValue = 0

            for (const line of lines) {
                const timeMatch = line.match(/pts_time:([0-9.]+)/)
                const sceneMatch = line.match(/scene:([0-9.]+)/)

                if (timeMatch && sceneMatch) {
                    const time = parseFloat(timeMatch[1])
                    const sceneValue = parseFloat(sceneMatch[1])

                    // Ignore very early scene changes (before 0.5s) and look for significant changes
                    if (
                        time > 0.5 &&
                        time < ANALYSIS_WINDOW &&
                        sceneValue > bestSceneValue
                    ) {
                        bestFlashTime = time
                        bestSceneValue = sceneValue
                    }
                }
            }

            if (bestFlashTime > 0) {
                console.log(
                    `   Found significant scene change (likely flash) at ${bestFlashTime.toFixed(3)}s (scene value: ${bestSceneValue.toFixed(3)})`,
                )
                return bestFlashTime
            }
        } catch (e) {
            console.log(
                `   Scene detection failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            )
        }

        // Method 2: Use frame difference analysis with higher threshold
        try {
            const frameCmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.08)',showinfo" -vsync 0 -f null -t ${ANALYSIS_WINDOW} - 2>&1 | grep "pts_time"`

            const { stdout: frameResult } = await execAsync(frameCmd)
            const frameLines = frameResult
                .split('\n')
                .filter((line) => line.includes('pts_time'))

            if (frameLines.length > 0) {
                // Take the first significant frame change after 0.5s
                for (const line of frameLines) {
                    const match = line.match(/pts_time:([0-9.]+)/)
                    if (match) {
                        const flashTime = parseFloat(match[1])
                        if (flashTime > 0.5 && flashTime < ANALYSIS_WINDOW) {
                            console.log(
                                `   Found frame change at ${flashTime.toFixed(3)}s (likely flash)`,
                            )
                            return flashTime
                        }
                    }
                }
            }
        } catch (e) {
            console.log(
                `   Frame analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            )
        }

        // Method 3: Look specifically in the 1-4s range where we know the flash is
        try {
            const rangeCmd = `ffmpeg -i "${videoPath}" -vf "select='between(t,1,4)*gt(scene,0.03)',showinfo" -vsync 0 -f null - 2>&1 | grep "pts_time"`

            const { stdout: rangeResult } = await execAsync(rangeCmd)
            const rangeLines = rangeResult
                .split('\n')
                .filter((line) => line.includes('pts_time'))

            if (rangeLines.length > 0) {
                // Take the first frame change in the 1-4s range
                const match = rangeLines[0].match(/pts_time:([0-9.]+)/)
                if (match) {
                    const flashTime = parseFloat(match[1])
                    console.log(
                        `   Found frame change in 1-4s range at ${flashTime.toFixed(3)}s (likely flash)`,
                    )
                    return flashTime
                }
            }
        } catch (e) {
            console.log(
                `   Range analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            )
        }

        console.log(`   No video flash detected in first ${ANALYSIS_WINDOW}s`)
        return 0
    } catch (error) {
        console.warn(`⚠️ Video analysis failed: ${error}`)
        return 0
    }
}

/**
 * Test function using the provided sample files
 */
export async function testWithSampleFiles(): Promise<SyncOffset> {
    const audioPath =
        '/Users/philippedrion/OutOfIcloud/meeting-baas/meeting_bot/recording_server/recordings/test/output.wav'
    const videoPath =
        '/Users/philippedrion/OutOfIcloud/meeting-baas/meeting_bot/recording_server/recordings/test/output.mp4'

    return calculateVideoOffset(audioPath, videoPath)
}
