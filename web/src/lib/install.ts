import { useSyncExternalStore } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallState {
  canInstall: boolean;
  isInstalled: boolean;
  isSecure: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInstalled = false;
const listeners = new Set<() => void>();

function getSecureStatus(): boolean {
  return typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
}

function getInstalledStatus(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  );
}

let currentSnapshot: InstallState = {
  canInstall: false,
  isInstalled: false,
  isSecure: getSecureStatus(),
};

function updateSnapshot() {
  currentSnapshot = {
    canInstall: deferredPrompt !== null,
    isInstalled: isInstalled || getInstalledStatus(),
    isSecure: getSecureStatus(),
  };
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== 'undefined') {
  isInstalled = getInstalledStatus();
  currentSnapshot = {
    canInstall: deferredPrompt !== null,
    isInstalled,
    isSecure: getSecureStatus(),
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    updateSnapshot();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    isInstalled = true;
    updateSnapshot();
  });

  const media = window.matchMedia('(display-mode: standalone)');
  if (media.addEventListener) {
    media.addEventListener('change', (e) => {
      isInstalled = e.matches;
      updateSnapshot();
    });
  }
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPrompt = null;
      updateSnapshot();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const SERVER_SNAPSHOT: InstallState = {
  canInstall: false,
  isInstalled: false,
  isSecure: false,
};

export function useInstallPrompt() {
  const state = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => currentSnapshot,
    () => SERVER_SNAPSHOT,
  );

  return {
    ...state,
    promptInstall,
  };
}
