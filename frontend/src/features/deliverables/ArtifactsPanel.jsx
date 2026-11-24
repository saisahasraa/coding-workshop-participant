import { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { deleteAttachment } from '../../api/collab';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useNotify } from '../../components/NotificationProvider';
import { formatDate } from '../../utils/format';
import { formatSize } from './commentText';
import { openAttachment } from './openAttachment';

/** Every file attached anywhere in this deliverable's conversation, newest first. */
export default function ArtifactsPanel({ attachments, onChanged }) {
  const notify = useNotify();
  const [deleting, setDeleting] = useState(null);
  const files = attachments?.data || [];

  return (
    <Card component="section" aria-labelledby="artifacts-heading">
      <CardContent>
        <Typography id="artifacts-heading" variant="h3" gutterBottom>Artifacts{attachments ? ` (${files.length})` : ''}</Typography>
        {attachments && !files.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {attachments.enabled ? 'Files attached to comments appear here.' : 'File storage is not set up in this environment.'}
          </Typography>
        )}
        <Stack component="ul" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {files.map((file) => (
            <Box component="li" key={file.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {file.is_image ? <ImageOutlinedIcon color="action" fontSize="small" /> : <InsertDriveFileOutlinedIcon color="action" fontSize="small" />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Link component="button" type="button" variant="body2" underline="hover" onClick={() => openAttachment(file.id, notify)}
                  sx={{ display: 'block', maxWidth: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {file.filename}
                </Link>
                <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                  {formatSize(file.size_bytes)} · {file.uploader_name || 'Unknown'} · {formatDate(file.created_at)}
                </Typography>
              </Box>
              {file.permissions.delete && (
                <Tooltip title="Remove file">
                  <IconButton size="small" aria-label={`Remove ${file.filename}`} onClick={() => setDeleting(file)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Tooltip>
              )}
            </Box>
          ))}
        </Stack>
      </CardContent>
      {deleting && (
        <ConfirmDialog
          open
          title="Remove file?"
          message={`"${deleting.filename}" will no longer be available. Comments that mention it will show it as removed.`}
          onConfirm={async () => { await deleteAttachment(deleting.id); notify('File removed'); onChanged(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}

ArtifactsPanel.propTypes = {
  /** The deliverable's attachments response, once loaded. */
  attachments: PropTypes.shape({ data: PropTypes.array.isRequired, enabled: PropTypes.bool }),
  onChanged: PropTypes.func.isRequired,
};
