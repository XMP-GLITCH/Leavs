import LeafProgress from '../common/LeafProgress'

function formatTimeAgo(date) {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours   = Math.floor(diff / 3_600_000)
  const days    = Math.floor(diff / 86_400_000)

  if (minutes < 1)  return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24)   return `${hours}h ago`
  if (days < 7)     return `${days}d ago`

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function BookCard({ book, onClick }) {
  const { title, author, cover, progress = 0, lastOpenedAt } = book
  const timeAgo = lastOpenedAt ? formatTimeAgo(new Date(lastOpenedAt)) : 'Never opened'

  return (
    <button className="book-card" onClick={onClick} aria-label={`Open ${title}`}>
      <div className="book-card__cover">
        {cover
          ? <img src={cover} alt="" className="book-card__img" />
          : (
            <div className="book-card__cover-placeholder" aria-hidden="true">
              {title[0]}
            </div>
          )
        }
      </div>

      <div className="book-card__body">
        <p className="book-card__title">{title}</p>
        <p className="book-card__author">{author}</p>
        <div className="book-card__footer">
          <LeafProgress progress={progress} size={18} />
          <span className="timestamp">{timeAgo}</span>
        </div>
      </div>
    </button>
  )
}
