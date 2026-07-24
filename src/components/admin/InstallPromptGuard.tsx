'use client';

import { useEffect } from 'react';

// Chrome's native "Add to Home screen" mini-infobar pins itself to the bottom
// of the viewport for installable PWAs. On short screens it sits over the
// last few rows of content (here: the Sign in button), and there's no CSS
// or scroll-position hook to dismiss a browser-native banner. Suppressing
// the prompt is the only real fix — preventDefault stops Chrome from
// showing it automatically; the captured event is kept in case a future
// "Install app" button in the admin UI wants to trigger it explicitly.
export default function InstallPromptGuard() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as unknown as { deferredInstallPrompt?: Event }).deferredInstallPrompt = e;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return null;
}
