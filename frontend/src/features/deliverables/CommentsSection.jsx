import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { addComment, deleteComment, listComments, updateComment } from '../../api/collab';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useNotify } from '../../components/NotificationProvider';
import useApi from '../../hooks/useApi';
import { formatDate } from '../../utils/format';

const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function Comment({ comment, onChanged }) {
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateComment(comment.id, draft);
      setEditing(false);
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack direction="row" spacing={1.5} component="li" sx={{ listStyle: 'none' }}>
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'primary.light' }}>{initials(comment.author_name)}</Avatar>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2">
          <strong>{comment.author_name}</strong>
          <Typography component="span" variant="body2" color="text.secondary">
            {' · '}{formatDate(comment.created_at)}{comment.edited && ' · edited'}
          </Typography>
        </Typography>
        {editing ? (
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <TextField value={draft} onChange={(e) => setDraft(e.target.value)} multiline minRows={2} disabled={busy} autoFocus label="Edit comment" />
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" onClick={save} disabled={busy || !draft.trim()}>Save</Button>
              <Button size="small" onClick={() => { setEditing(false); setDraft(comment.body); }} disabled={busy}>Cancel</Button>
            </Stack>
          </Stack>
        ) : (
          <>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</Typography>
            <Stack direction="row" spacing={1}>
              {comment.permissions.update && <Button size="small" onClick={() => setEditing(true)}>Edit</Button>}
              {comment.permissions.delete && <Button size="small" color="error" onClick={() => setDeleting(true)}>Delete</Button>}
            </Stack>
          </>
        )}
      </Box>
      {deleting && (
        <ConfirmDialog
          open
          title="Delete comment?"
          message="This comment will be permanently removed."
          onConfirm={async () => { await deleteComment(comment.id); notify('Comment deleted'); onChanged(); }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Stack>
  );
}

Comment.propTypes = { comment: PropTypes.object.isRequired, onChanged: PropTypes.func.isRequired };

/** Conversation on a deliverable. Viewers can read but not write. */
export default function CommentsSection({ deliverableKey, canComment }) {
  const notify = useNotify();
  const loader = useCallback((signal) => listComments(deliverableKey, signal), [deliverableKey]);
  const { data, error, loading, reload } = useApi(loader);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addComment(deliverableKey, text.trim());
      setText('');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const comments = data?.data || [];
  return (
    <Box component="section" aria-labelledby="comments-heading">
      <Typography id="comments-heading" variant="h3" gutterBottom>Comments{data ? ` (${comments.length})` : ''}</Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error.message}</Alert>}
      {!loading && !comments.length && !error && <Typography color="text.secondary" sx={{ mb: 2 }}>No comments yet.</Typography>}
      <Stack spacing={2} component="ul" sx={{ p: 0, m: 0, mb: 2 }}>
        {comments.map((comment) => <Comment key={comment.id} comment={comment} onChanged={reload} />)}
      </Stack>
      {canComment && (
        <form onSubmit={submit}>
          <Stack spacing={1}>
            <TextField label="Add a comment" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={2} disabled={busy}
              slotProps={{ htmlInput: { maxLength: 5000 } }} />
            <div><Button type="submit" variant="contained" disabled={busy || !text.trim()}>Comment</Button></div>
          </Stack>
        </form>
      )}
    </Box>
  );
}

CommentsSection.propTypes = {
  /** Deliverable key (e.g. ENG-12) or id. */
  deliverableKey: PropTypes.string.isRequired,
  canComment: PropTypes.bool,
};
