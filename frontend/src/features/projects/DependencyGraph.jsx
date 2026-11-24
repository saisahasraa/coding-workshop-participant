import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import StatusChip from '../../components/StatusChip';
import { layout, NODE_H, NODE_W } from './graphLayout';

const borderFor = (node) => {
  if (node.status === 'completed') return 'success.main';
  if (node.status === 'blocked' || node.open_blockers > 0) return 'error.main';
  return node.ready ? 'primary.main' : 'divider';
};

/**
 * Work items in columns by how many blockers come before them, with arrows from blocker to blocked.
 * The arrows are decoration: the same relationships are listed as text beside the graph.
 */
export default function DependencyGraph({ nodes, edges }) {
  const { positions, width, height } = layout(nodes);
  return (
    <Box sx={{ overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Box sx={{ position: 'relative', width, height }}>
        <svg width={width} height={height} aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#dep-arrow)">
            {edges.map((e) => {
              const from = positions[e.source];
              const to = positions[e.target];
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              return <path key={`${e.source}>${e.target}`} d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`} />;
            })}
          </g>
        </svg>
        {nodes.map((n) => (
          <Box
            key={n.key}
            sx={{
              position: 'absolute', left: positions[n.key].x, top: positions[n.key].y, width: NODE_W, height: NODE_H,
              p: 1, bgcolor: 'background.paper', border: 2, borderColor: borderFor(n), borderStyle: n.external ? 'dashed' : 'solid',
              borderRadius: 1, overflow: 'hidden', opacity: n.status === 'completed' ? 0.7 : 1,
            }}
          >
            <Link component={RouterLink} to={`/deliverables/${n.key}`} underline="hover" variant="body2" sx={{
              fontWeight: 600
            }}>{n.key}</Link>
            <Typography variant="body2" noWrap title={n.name}>{n.name}</Typography>
            <StatusChip value={n.status} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

DependencyGraph.propTypes = {
  nodes: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired, name: PropTypes.string.isRequired, depth: PropTypes.number.isRequired,
    status: PropTypes.string.isRequired, ready: PropTypes.bool, external: PropTypes.bool, open_blockers: PropTypes.number,
  })).isRequired,
  edges: PropTypes.arrayOf(PropTypes.shape({ source: PropTypes.string.isRequired, target: PropTypes.string.isRequired })).isRequired,
};
