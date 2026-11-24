import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { addComment, deleteComment, listComments, updateComment } from '../../api/collab';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useNotify } from '../../components/NotificationProvider';
import useApi from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';
import { avatarColor, initials } from '../../utils/people';
import { toneText } from '../../utils/tonal';
import CommentComposer from './CommentComposer';
import { parseComment } from './commentText';
import FileLink from './FileLink';

/** Comment text with its mentions highlighted and its files shown in place. */
function CommentBody({ comment, files }) {
  return (
    <Typography component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {parseComment(comment.body, comment.mentions).map((part, index) => {
        const key = `${part.type}-${index}`;
        if (part.type === 'mention') return <Box key={key} component="span" sx={[toneText('primary'), { fontWeight: 600 }]}>{part.value}</Box>;
        if (part.type === 'file') {
          const file = files[part.id];
          return <FileLink key={key} id={part.id} name={file?.filename || part.name} isImage={Boolean(file?.is_image)} missing={!file} />;
        }
        return <span key={key}>{part.value}</span>;
      })}
    </Typography>
  );
}

CommentBody.propTypes = { comment: PropTypes.object.isRequired, files: PropTypes.object.isRequired };

function Comment({ comment, composer, files, onChanged }) {
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <Stack direction="row" spacing={1.5} component="li" sx={{ listStyle: 'none' }}>
      <Avatar aria-hidden sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 700, bgcolor: avatarColor(comment.author_name), color: '#fff' }}>{initials(comment.author_name)}</Avatar>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2">
          <strong>{comment.author_name}</strong>
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
            {' · '}{formatDateTime(comment.created_at)}{comment.edited && ' · edited'}
          </Typography>
        </Typography>
        {editing ? (
          <Box sx={{ mt: 1 }}>
            <CommentComposer
              {...composer} label="Edit comment" submitLabel="Save" autoFocus
              initialText={comment.body} initialMentions={comment.mentions}
              onSubmit={async (text, mentions) => { await updateComment(comment.id, text, mentions); setEditing(false); onChanged(); }}
              onCancel={() => setEditing(false)}
            />
          </Box>
        ) : (
          <>
            <CommentBody comment={comment} files={files} />
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
          message="This comment will be permanently removed. Its files stay under Artifacts."
          onConfirm={async () => { await deleteComment(comment.id); notify('Comment deleted'); onChanged(); }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Stack>
  );
}

Comment.propTypes = {
  comment: PropTypes.object.isRequired, composer: PropTypes.object.isRequired, files: PropTypes.object.isRequired, onChanged: PropTypes.func.isRequired,
};

/** Conversation on a deliverable, with @mentions and attached files. Who may write is the project's choice. */
export default function CommentsSection({ deliverableKey, people, attachments, onFilesChanged }) {
  const loader = useCallback((signal) => listComments(deliverableKey, signal), [deliverableKey]);
  const { data, error, loading, reload } = useApi(loader);
  const comments = data?.data || [];
  const files = Object.fromEntries((attachments?.data || []).map((file) => [file.id, file]));
  const refresh = () => { reload(); onFilesChanged(); };
  const composer = {
    deliverableKey, people, onFilesChanged, maxSizeMb: attachments?.max_size_mb ?? 10, uploadsEnabled: Boolean(attachments?.enabled),
  };

  return (
    <Box component="section" aria-labelledby="comments-heading">
      <Typography id="comments-heading" variant="h3" gutterBottom>Comments{data ? ` (${comments.length})` : ''}</Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error.message}</Alert>}
      {!loading && !comments.length && !error && <Typography sx={{ color: 'text.secondary', mb: 2 }}>No comments yet.</Typography>}
      <Stack spacing={2} component="ul" sx={{ p: 0, m: 0, mb: 2 }}>
        {comments.map((comment) => <Comment key={comment.id} comment={comment} composer={composer} files={files} onChanged={refresh} />)}
      </Stack>
      {data?.can_comment && (
        <CommentComposer {...composer} onSubmit={async (text, mentions) => { await addComment(deliverableKey, text, mentions); refresh(); }} />
      )}
      {data && !data.can_comment && <Typography variant="body2" sx={{ color: 'text.secondary' }}>You can read this conversation but not add to it.</Typography>}
    </Box>
  );
}

CommentsSection.propTypes = {
  /** Deliverable key (e.g. ENG-12) or id. */
  deliverableKey: PropTypes.string.isRequired,
  /** People who can be mentioned, as `{value, label}`. */
  people: PropTypes.array.isRequired,
  /** The deliverable's attachments response (`{data, max_size_mb, enabled}`), once loaded. */
  attachments: PropTypes.object,
  /** Reload the attachments (after an upload, or a comment that claims files). */
  onFilesChanged: PropTypes.func.isRequired,
};
