// ================================
// usePageStyles Hook
// Generates CSS for editor backgrounds based on PageSettings
// ================================

import { useMemo } from 'react';
import { PageSettingsConfig, ContentWidth } from '../components/PageSettings';

// ================================
// Types
// ================================

export interface PageStyles {
  /** CSS class name to apply to editor container */
  className: string;
  /** Inline styles for editor container */
  containerStyle: React.CSSProperties;
  /** Inline styles for content area */
  contentStyle: React.CSSProperties;
  /** CSS custom properties to apply */
  cssVariables: Record<string, string>;
}

// ================================
// Content Width Mapping
// ================================

const CONTENT_WIDTH_MAP: Record<ContentWidth, string> = {
  narrow: '560px',
  medium: '720px',
  wide: '900px',
  full: '100%',
};

// ================================
// Hook Implementation
// ================================

export function usePageStyles(settings: PageSettingsConfig): PageStyles {
  return useMemo(() => {
    // Build CSS variables
    const cssVariables: Record<string, string> = {
      '--page-font-family': settings.fontFamily,
      '--page-font-size': `${settings.fontSize}px`,
      '--page-line-height': String(settings.lineHeight),
      '--page-content-width': CONTENT_WIDTH_MAP[settings.contentWidth],
      '--page-margin-top': `${settings.marginTop}px`,
      '--page-margin-bottom': `${settings.marginBottom}px`,
      '--page-bg-opacity': String(settings.backgroundOpacity),
      '--page-line-spacing': `${settings.lineSpacing}px`,
      '--page-grid-size': `${settings.gridSize}px`,
      '--page-dot-spacing': `${settings.dotSpacing}px`,
    };

    // Build container style
    const containerStyle: React.CSSProperties = {
      ...cssVariables,
    } as React.CSSProperties;

    // Build content style
    const contentStyle: React.CSSProperties = {
      fontFamily: settings.fontFamily,
      fontSize: `${settings.fontSize}px`,
      lineHeight: settings.lineHeight,
      maxWidth: CONTENT_WIDTH_MAP[settings.contentWidth],
      marginTop: `${settings.marginTop}px`,
      marginBottom: `${settings.marginBottom}px`,
    };

    // Build class names
    const classNames: string[] = ['page-editor'];

    // Background class
    if (settings.background !== 'none') {
      classNames.push(`page-bg-${settings.background}`);
    }

    // Special mode classes
    if (settings.typewriterMode) {
      classNames.push('typewriter-mode');
    }

    if (settings.focusMode) {
      classNames.push('focus-mode');
    }

    return {
      className: classNames.join(' '),
      containerStyle,
      contentStyle,
      cssVariables,
    };
  }, [settings]);
}

// ================================
// CSS for Page Backgrounds
// This should be included in a global stylesheet
// ================================

export const PAGE_BACKGROUND_CSS = `
/* Page Editor Base Styles */
.page-editor {
  position: relative;
  min-height: 100%;
  padding: var(--page-margin-top, 48px) 0 var(--page-margin-bottom, 48px);
}

.page-editor .editor-content {
  max-width: var(--page-content-width, 720px);
  margin: 0 auto;
  padding: 0 var(--spacing-6, 24px);
}

/* Lines Background */
.page-editor.page-bg-lines {
  background-image: repeating-linear-gradient(
    transparent,
    transparent calc(var(--page-line-spacing, 28px) - 1px),
    color-mix(in srgb, var(--border-primary) calc(var(--page-bg-opacity, 0.3) * 100%), transparent) calc(var(--page-line-spacing, 28px) - 1px),
    color-mix(in srgb, var(--border-primary) calc(var(--page-bg-opacity, 0.3) * 100%), transparent) var(--page-line-spacing, 28px)
  );
  background-position: 0 var(--page-margin-top, 48px);
}

/* Grid Background */
.page-editor.page-bg-grid {
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--border-primary) calc(var(--page-bg-opacity, 0.3) * 100%), transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--border-primary) calc(var(--page-bg-opacity, 0.3) * 100%), transparent) 1px,
      transparent 1px
    );
  background-size: var(--page-grid-size, 20px) var(--page-grid-size, 20px);
}

/* Dots Background */
.page-editor.page-bg-dots {
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--border-primary) calc(var(--page-bg-opacity, 0.3) * 100%), transparent) 1px,
    transparent 1px
  );
  background-size: var(--page-dot-spacing, 16px) var(--page-dot-spacing, 16px);
}

/* Typewriter Mode - Keep current line centered */
.page-editor.typewriter-mode {
  scroll-padding-top: 40vh;
  scroll-padding-bottom: 40vh;
}

.page-editor.typewriter-mode .editor-content {
  padding-bottom: 50vh;
}

.page-editor.typewriter-mode .current-line,
.page-editor.typewriter-mode [data-current-line="true"] {
  /* This will be handled by the editor component */
}

/* Focus Mode - Highlight current paragraph */
.page-editor.focus-mode p,
.page-editor.focus-mode li,
.page-editor.focus-mode h1,
.page-editor.focus-mode h2,
.page-editor.focus-mode h3,
.page-editor.focus-mode h4,
.page-editor.focus-mode h5,
.page-editor.focus-mode h6,
.page-editor.focus-mode blockquote {
  opacity: 0.3;
  transition: opacity 0.2s ease;
}

.page-editor.focus-mode p:focus-within,
.page-editor.focus-mode li:focus-within,
.page-editor.focus-mode h1:focus-within,
.page-editor.focus-mode h2:focus-within,
.page-editor.focus-mode h3:focus-within,
.page-editor.focus-mode h4:focus-within,
.page-editor.focus-mode h5:focus-within,
.page-editor.focus-mode h6:focus-within,
.page-editor.focus-mode blockquote:focus-within,
.page-editor.focus-mode p.active,
.page-editor.focus-mode li.active,
.page-editor.focus-mode [data-focused="true"] {
  opacity: 1;
}

/* Also show adjacent paragraphs at medium opacity */
.page-editor.focus-mode p.active + p,
.page-editor.focus-mode [data-focused="true"] + p {
  opacity: 0.6;
}
`;

export default usePageStyles;
