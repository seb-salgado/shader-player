let audioContext: AudioContext | null = null;
let isInitialized = false;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.warn("AudioContext not supported");
      return null;
    }
  }
  return audioContext;
}

export async function initializeAudioContext() {
  if (isInitialized) return;
  
  const ctx = getAudioContext();
  if (!ctx) return;
  
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (error) {
      console.warn("Failed to resume audio context");
    }
  }
  
  isInitialized = true;
}
