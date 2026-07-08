/** Question/answer face with optional bundled or hosted image. */
export function CardFace({
  text,
  imageUrl,
  variant = 'question',
  imageAlt,
}: {
  text?: string
  imageUrl?: string
  variant?: 'question' | 'answer'
  imageAlt?: string
}) {
  const hasText = Boolean(text?.trim())
  if (!hasText && !imageUrl) return null

  return (
    <div className={`card-face ${variant}${imageUrl ? ' has-media' : ''}`.trim()}>
      {imageUrl ? (
        <figure className="card-face-media">
          <img src={imageUrl} alt={imageAlt ?? (hasText ? text : 'Card image')} className="card-face-img" />
        </figure>
      ) : null}
      {hasText ? <p className="card-face-text">{text}</p> : null}
    </div>
  )
}