import { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { fetchDependencies } from '../../api/resources';
import useApi from '../../hooks/useApi';
import DependencyGraph from './DependencyGraph';

/** Waiting relationships as text: "WEB-4 waits for WEB-2, WEB-3". */
function waitingList(nodes, edges) {
  const byTarget = {};
  edges.forEach((e) => { (byTarget[e.target] ||= []).push(e.source); });
  return nodes.filter((n) => byTarget[n.key]).map((n) => ({ node: n, blockers: byTarget[n.key] }));
}

/** Project → Dependencies: what blocks what, and which work is ready to start. */
export default function DependenciesTab({ project }) {
  const loader = useCallback((signal) => fetchDependencies(project.key, signal), [project.key]);
  const { data, error, loading } = useApi(loader);
  const waiting = useMemo(() => (data ? waitingList(data.nodes, data.edges) : []), [data]);

  if (error && !data) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <LinearProgress aria-label="Loading dependencies" />;
  if (!data.edges.length) {
    return (
      <Typography color="text.secondary">
        No dependencies yet. Open a deliverable and link it under Linked work items (blocks / is blocked by) to see the chain here.
      </Typography>
    );
  }
  const own = data.nodes.filter((n) => !n.external);
  const ready = own.filter((n) => n.ready && data.edges.some((e) => e.source === n.key)).length;

  return (
    <Stack spacing={2}>
      {loading && <LinearProgress aria-label="Refreshing" />}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip variant="outlined" label={`${data.edges.length} dependenc${data.edges.length === 1 ? 'y' : 'ies'}`} />
        <Chip variant="outlined" label={`Longest chain: ${data.longest_chain} items`} />
        <Chip variant="outlined" color="primary" label={`${ready} ready and blocking others`} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Columns show how many blockers come before an item. Blue: ready to start. Red: waiting on unfinished work. Green: done. Dashed: another project.
      </Typography>
      <DependencyGraph nodes={data.nodes} edges={data.edges} />
      <section aria-labelledby="waiting-heading">
        <Typography id="waiting-heading" variant="h3" gutterBottom>Waiting on</Typography>
        <Stack component="ul" spacing={0.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {waiting.map(({ node, blockers }) => (
            <li key={node.key}>
              <Typography component="span">
                <Link component={RouterLink} to={`/deliverables/${node.key}`} fontWeight={600} underline="hover">{node.key}</Link>
                {' '}waits for{' '}
                {blockers.map((b, i) => (
                  <span key={b}>{i > 0 && ', '}<Link component={RouterLink} to={`/deliverables/${b}`} underline="hover">{b}</Link></span>
                ))}
              </Typography>
            </li>
          ))}
        </Stack>
      </section>
    </Stack>
  );
}

DependenciesTab.propTypes = { project: PropTypes.shape({ key: PropTypes.string.isRequired }).isRequired };
