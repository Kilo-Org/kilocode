import React from 'react';

/**
 * Renders an image with an optional caption.
 * @param {object} props - The component props.
 * @param {string} props.src - The image source URL.
 * @param {string} props.alt - The alt text for the image.
 * @param {string} [props.width] - The width of the image.
 * @param {string} [props.caption] - The optional caption for the image.
 * @returns {JSX.Element} The Image component.
 */
const Image = ({ src, alt, width, caption }) => {
  return (
    <div style={{ textAlign: 'center' }}>
      <img src={src} alt={alt} width={width} />
      {caption && (
        <>
          <br />
          <small>
            <i>{caption}</i>
          </small>
        </>
      )}
    </div>
  );
};

export default Image;