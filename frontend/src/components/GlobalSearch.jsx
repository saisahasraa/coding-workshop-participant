import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Autocomplete from '@mui/material/Autocomplete';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { fetchSearch } from '../api/resources';
import { labelize } from '../utils/format';

const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;
const GROUPS = { projects: 'Projects', deliverables: 'Deliverables', people: 'People' };

/** Flatten the grouped API response into options that know where they lead. */
function toOptions(result) {
  return [
    ...result.projects.map((p) => ({ group: 'projects', id: `p${p.id}`, label: p.key, detail: p.name, to: `/projects/${p.key}` })),
    ...result.deliverables.map((d) => ({ group: 'deliverables', id: `d${d.id}`, label: d.key, detail: d.name, to: `/deliverables/${d.key}` })),
    ...result.people.map((u) => ({ group: 'people', id: `u${u.id}`, label: u.name, detail: u.job_title || labelize(u.role), to: `/deliverables?owner_id=${u.id}` })),
  ];
}

/** App bar search: type to find projects, deliverables and people, then pick one to open it. */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const query = text.trim();
  const searchable = query.length >= MIN_LENGTH;

  useEffect(() => {
    if (!searchable) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetchSearch(query, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setOptions(toOptions(result)); setLoading(false); } })
        .catch(() => { if (!controller.signal.aborted) { setOptions([]); setLoading(false); } });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchable]);

  return (
    <Autocomplete
      size="small"
      options={searchable ? options : []}
      loading={searchable && loading}
      inputValue={text}
      value={null}
      onInputChange={(_e, value, reason) => { if (reason !== 'reset') setText(value); }}
      onChange={(_e, option) => { if (option) { setText(''); setOptions([]); navigate(option.to); } }}
      filterOptions={(all) => all}
      groupBy={(option) => GROUPS[option.group]}
      getOptionLabel={(option) => `${option.label} ${option.detail}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText={searchable ? 'Nothing found' : `Type at least ${MIN_LENGTH} characters`}
      sx={{ width: { xs: 150, sm: 260, md: 360 }, mx: 1 }}
      renderOption={({ key, ...props }, option) => (
        <li key={key} {...props}>
          <Typography fontWeight={600} sx={{ mr: 1, whiteSpace: 'nowrap' }}>{option.label}</Typography>
          <Typography color="text.secondary" noWrap>{option.detail}</Typography>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search…"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Search projects, deliverables and people' },
            input: { ...params.slotProps.input, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }}
          sx={{ bgcolor: 'background.default', borderRadius: 1 }}
        />
      )}
    />
  );
}
