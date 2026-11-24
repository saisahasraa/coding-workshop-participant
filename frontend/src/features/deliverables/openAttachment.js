import { attachmentLink } from '../../api/collab';

/** Open a file through a fresh signed link (links expire after a few minutes, so they are never kept). */
export async function openAttachment(id, notify) {
  try {
    const { url } = await attachmentLink(id);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    notify(err.message, 'error');
  }
}
