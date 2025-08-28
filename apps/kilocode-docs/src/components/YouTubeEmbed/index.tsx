import React, { useState, useCallback, useEffect, useMemo } from 'react';
import styles from './styles.module.css';

/**
 * YouTube embed parameters interface
 * @see https://developers.google.com/youtube/player_parameters
 */
interface YouTubeEmbedParams {
  /** Show related videos at the end (0 = no, 1 = yes) */
  rel?: 0 | 1;
  /** Use YouTube's modest branding (0 = no, 1 = yes) */
  modestbranding?: 0 | 1;
  /** Enable privacy-enhanced mode (0 = no, 1 = yes) */
  privacy?: 0 | 1;
  /** Auto-play the video (0 = no, 1 = yes) */
  autoplay?: 0 | 1;
  /** Show video controls (0 = no, 1 = yes) */
  controls?: 0 | 1;
  /** Show video info (0 = no, 1 = yes) */
  showinfo?: 0 | 1;
  /** Loop the video (0 = no, 1 = yes) */
  loop?: 0 | 1;
  /** Start time in seconds */
  start?: number;
  /** End time in seconds */
  end?: number;
}

interface YouTubeEmbedProps {
  /**
   * YouTube video URL or video ID
   */
  url: string;
  /**
   * Optional caption to display below the video
   */
  caption?: string;
  /**
   * Optional title for the iframe (for accessibility)
   */
  title?: string;
  /**
   * Optional YouTube embed parameters
   */
  embedParams?: YouTubeEmbedParams;
  /**
   * Optional callback for when the video fails to load
   */
  onError?: (error: Error) => void;
  /**
   * Optional callback for when the video successfully loads
   */
  onLoad?: () => void;
}

/**
 * Error that occurs when a YouTube video ID cannot be extracted
 */
class YouTubeExtractError extends Error {
  constructor(url: string) {
    super(`Could not extract YouTube video ID from: ${url}`);
    this.name = 'YouTubeExtractError';
  }
}

/**
 * Extracts the YouTube video ID from a URL or returns the ID if already provided
 * @param {string} urlOrId - YouTube URL or video ID
 * @returns {string | null} YouTube video ID or null if extraction fails
 */
const extractVideoId = (urlOrId: string): string | null => {
  // Trim whitespace
  const trimmedUrl = urlOrId.trim();
  
  // If empty, return null
  if (!trimmedUrl) {
    return null;
  }
  
  // If it's just the ID (no slashes or dots)
  if (!/[\/.]/.test(trimmedUrl) && /^[a-zA-Z0-9_-]{11}$/.test(trimmedUrl)) {
    return trimmedUrl;
  }

  // Extract from various YouTube URL formats
  const regexPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const regex of regexPatterns) {
    const match = trimmedUrl.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  // If no pattern matches, return null
  return null;
};

/**
 * Builds the YouTube embed URL with parameters
 * @param {string} videoId - YouTube video ID
 * @param {YouTubeEmbedParams} params - Embed parameters
 * @returns {string} Complete embed URL
 */
const buildEmbedUrl = (videoId: string, params: YouTubeEmbedParams = {}): string => {
  // Start with base URL
  const baseUrl = params.privacy
    ? `https://www.youtube-nocookie.com/embed/${videoId}`
    : `https://www.youtube.com/embed/${videoId}`;
  
  // Default parameters
  const defaultParams: YouTubeEmbedParams = {
    rel: 0,
    modestbranding: 1,
    controls: 1,
  };
  
  // Merge default and custom parameters
  const mergedParams = { ...defaultParams, ...params };
  
  // Convert parameters to URL query string
  const queryParams = Object.entries(mergedParams)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  
  return `${baseUrl}?${queryParams}`;
};

/**
 * A responsive YouTube video embed component with enhanced features
 *
 * @example
 * // With video ID
 * <YouTubeEmbed url="dQw4w9WgXcQ" />
 *
 * @example
 * // With full YouTube URL and custom parameters
 * <YouTubeEmbed
 *   url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 *   caption="Rick Astley - Never Gonna Give You Up"
 *   embedParams={{ autoplay: 1, start: 30 }}
 * />
 */
export default function YouTubeEmbed({
  url,
  caption,
  title = 'YouTube video player',
  embedParams = {},
  onError,
  onLoad
}: YouTubeEmbedProps): JSX.Element {
  // State for loading and error handling
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Extract video ID with memoization to prevent unnecessary processing
  const videoId = useMemo(() => {
    try {
      const id = extractVideoId(url);
      if (!id) {
        throw new YouTubeExtractError(url);
      }
      return id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      return null;
    }
  }, [url, onError]);
  
  // Build embed URL with memoization
  const embedUrl = useMemo(() => {
    if (!videoId) return '';
    return buildEmbedUrl(videoId, embedParams);
  }, [videoId, embedParams]);
  
  // Handle iframe load event
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    onLoad?.();
  }, [onLoad]);
  
  // Handle iframe error event
  const handleIframeError = useCallback(() => {
    const loadError = new Error(`Failed to load YouTube video: ${url}`);
    setError(loadError);
    onError?.(loadError);
  }, [url, onError]);
  
  // Reset loading state when URL changes
  useEffect(() => {
    setIsLoading(true);
    setError(null);
  }, [url]);

  // If there's an error, show error UI
  if (error) {
    return (
      <div className={styles.youtubeWrapper}>
        <div className={styles.errorContainer}>
          <div className={styles.errorIcon}>⚠️</div>
          <p>Failed to load YouTube video</p>
          <p>{error.message}</p>
        </div>
        {caption && <div className={styles.caption}>{caption}</div>}
      </div>
    );
  }

  return (
    <div className={styles.youtubeWrapper}>
      <div className={styles.videoContainer}>
        {videoId && (
          <iframe
            className={`${styles.videoIframe} ${isLoading ? styles.loading : ''}`}
            src={embedUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            aria-labelledby={caption ? `youtube-caption-${videoId}` : undefined}
          />
        )}
      </div>
      {caption && (
        <div
          className={styles.caption}
          id={videoId ? `youtube-caption-${videoId}` : undefined}
        >
          {caption}
        </div>
      )}
    </div>
  );
}