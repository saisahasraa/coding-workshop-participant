import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import SearchIcon from '@mui/icons-material/Search';

/** Search box that reports its value after the user pauses typing. */
export default function SearchField({
  value, onChange, label = 'Search', delayMs = 300,
}) {
  const [text, setText] = useState(value || '');

  useEffect(() => {
    if (text === (value || '')) return undefined;
    const timer = setTimeout(() => onChange(text), delayMs);
    return () => clearTimeout(timer);
  }, [text, value, onChange, delayMs]);

  return (
    <TextField
      label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      type="search"
      sx={{ minWidth: { sm: 260 } }}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
    />
  );
}

SearchField.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  delayMs: PropTypes.number,
};
