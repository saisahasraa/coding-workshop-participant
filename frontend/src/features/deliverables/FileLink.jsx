import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { attachmentLink } from '../../api/collab';
import { openAttachment } from './openAttachment';
import { useNotify } from '../../components/NotificationProvider';

/** A file in a comment: images show as a thumbnail, everything else as a chip. Click to open it. */
export default function FileLink({ id, name, isImage = false, missing = false }) {
  const notify = useNotify();
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!isImage || missing) return undefined;
    const controller = new AbortController();
    attachmentLink(id, controller.signal).then((link) => setSrc(link.url)).catch(() => {});
    return () => controller.abort();
  }, [id, isImage, missing]);

  if (missing) return <Chip size="small" variant="outlined" icon={<AttachFileIcon />} label={`${name} (removed)`} disabled />;
  if (isImage && src) {
    return (
      <Box component="button" type="button" onClick={() => openAttachment(id, notify)} aria-label={`Open image ${name}`}
        sx={{ display: 'block', my: 1, p: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', cursor: 'zoom-in', bgcolor: 'transparent', maxWidth: '100%' }}>
        <Box component="img" src={src} alt={name} sx={{ display: 'block', maxWidth: '100%', maxHeight: 260 }} />
      </Box>
    );
  }
  return <Chip size="small" variant="outlined" icon={<AttachFileIcon />} label={name} onClick={() => openAttachment(id, notify)} sx={{ mx: 0.25 }} />;
}

FileLink.propTypes = {
  id: PropTypes.number.isRequired,
  name: PropTypes.string.isRequired,
  isImage: PropTypes.bool,
  /** The file was deleted after the comment was written. */
  missing: PropTypes.bool,
};
