import { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { uploadAttachment } from '../../api/collab';
import { useNotify } from '../../components/NotificationProvider';
import Person from '../../components/Person';
import { insertAt, mentionedIds, mentionQuery } from './commentText';

const MAX_SUGGESTIONS = 6;

/**
 * Comment editor: type `@` to mention someone, and attach files, which are inserted where the caret is.
 * Calls `onSubmit(text, mentionIds)`; reject to keep the draft.
 */
export default function CommentComposer({
  deliverableKey, people, maxSizeMb, uploadsEnabled, initialText = '', initialMentions = [], label = 'Add a comment', submitLabel = 'Comment',
  onSubmit, onCancel, onFilesChanged, autoFocus = false,
}) {
  const notify = useNotify();
  const input = useRef(null);
  const files = useRef(null);
  const caret = useRef(initialText.length);
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState(initialMentions);
  const [suggest, setSuggest] = useState(null); // {query, start, index}
  const [anchorEl, setAnchorEl] = useState(null); // the text field, for placing the suggestions
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);

  const matches = suggest
    ? people.filter((p) => p.label.toLowerCase().includes(suggest.query.toLowerCase())).slice(0, MAX_SUGGESTIONS)
    : [];
  const open = Boolean(suggest) && matches.length > 0;

  const place = (next, position) => {
    setText(next);
    caret.current = position;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
  };

  const handleChange = (event) => {
    const { value, selectionStart } = event.target;
    setText(value);
    caret.current = selectionStart;
    const found = mentionQuery(value, selectionStart);
    setAnchorEl(event.target);
    setSuggest(found && { ...found, index: 0 });
  };

  const pick = (person) => {
    const before = text.slice(0, suggest.start);
    const after = text.slice(caret.current);
    const mention = `@${person.label} `;
    setPicked((list) => (list.some((p) => p.id === person.value) ? list : [...list, { id: person.value, name: person.label }]));
    setSuggest(null);
    place(before + mention + after, before.length + mention.length);
  };

  const handleKeyDown = (event) => {
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSuggest((s) => ({ ...s, index: (s.index + step + matches.length) % matches.length }));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(matches[suggest.index]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setSuggest(null);
    }
  };

  const attach = async (event) => {
    const chosen = [...event.target.files];
    event.target.value = '';
    for (const file of chosen) {
      if (file.size > maxSizeMb * 1024 * 1024) {
        notify(`${file.name} is larger than ${maxSizeMb} MB`, 'error');
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const record = await uploadAttachment(deliverableKey, file);
        // Read the latest text from the field itself: several uploads may finish in any order.
        const current = input.current?.value ?? '';
        const next = insertAt(current, Math.min(caret.current, current.length), `[${record.filename}](attachment:${record.id})`);
        place(next.text, next.caret);
        onFilesChanged?.();
      } catch (err) {
        notify(`${file.name}: ${err.details?.size_bytes || err.message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await onSubmit(body, mentionedIds(body, picked));
      setText('');
      setPicked([]);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack spacing={1}>
        <TextField
          label={label} value={text} onChange={handleChange} onKeyDown={handleKeyDown} multiline minRows={3} disabled={busy} autoFocus={autoFocus}
          inputRef={input}
          onSelect={(e) => { caret.current = e.target.selectionStart; }}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          helperText="Type @ to mention someone. Attached files are placed where your cursor is."
          slotProps={{ htmlInput: { maxLength: 5000 } }}
        />
        <Popper open={open} anchorEl={anchorEl} placement="bottom-start" sx={{ zIndex: (t) => t.zIndex.modal + 1 }}>
          <Paper elevation={6} sx={{ mt: 0.5, minWidth: 240 }}>
            <MenuList dense aria-label="People to mention">
              {matches.map((person, index) => (
                <MenuItem key={person.value} selected={index === suggest?.index} onMouseDown={(e) => { e.preventDefault(); pick(person); }}>
                  <Person name={person.label} />
                </MenuItem>
              ))}
            </MenuList>
          </Paper>
        </Popper>
        {uploading > 0 && <LinearProgress aria-label="Uploading file" />}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button type="submit" variant="contained" disabled={busy || uploading > 0 || !text.trim()}>{submitLabel}</Button>
          {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
          <input ref={files} type="file" multiple hidden onChange={attach} aria-label="Choose files to attach" />
          <Tooltip title={uploadsEnabled ? `Attach files (up to ${maxSizeMb} MB each)` : 'File storage is not set up in this environment'}>
            <span>
              <Button startIcon={<AttachFileIcon />} onClick={() => files.current?.click()} disabled={!uploadsEnabled || busy}>Attach</Button>
            </span>
          </Tooltip>
          {uploading > 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Uploading…</Typography>}
        </Stack>
      </Stack>
    </form>
  );
}

CommentComposer.propTypes = {
  deliverableKey: PropTypes.string.isRequired,
  /** People who can be mentioned, as `{value: id, label: name}`. */
  people: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.number.isRequired, label: PropTypes.string.isRequired })).isRequired,
  maxSizeMb: PropTypes.number.isRequired,
  uploadsEnabled: PropTypes.bool.isRequired,
  initialText: PropTypes.string,
  initialMentions: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.number, name: PropTypes.string })),
  label: PropTypes.string,
  submitLabel: PropTypes.string,
  /** `(text, mentionIds) => Promise` */
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
  /** Called after a file was uploaded. */
  onFilesChanged: PropTypes.func,
  autoFocus: PropTypes.bool,
};
