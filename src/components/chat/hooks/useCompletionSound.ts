import { useCallback, useRef } from 'react';

/**
 * Plays a soft two-tone chime using the Web Audio API when a model response completes.
 * No external audio files needed — the sound is synthesized on the fly.
 */
export function useCompletionSound() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playCompletionSound = useCallback(() => {
    try {
      // Lazily create the AudioContext so we don't require a user gesture until playback.
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;

      const playTone = (frequency: number, startTime: number, duration: number) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);

        // Soft envelope: quick attack, smooth decay
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      // Two ascending tones: a pleasant "ding-ding"
      playTone(880, now, 0.25);
      playTone(1100, now + 0.18, 0.3);
    } catch {
      // Silently ignore if AudioContext is unavailable (e.g., server-side rendering)
    }
  }, []);

  return playCompletionSound;
}
