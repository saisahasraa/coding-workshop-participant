import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** Page title with optional subtitle and right-aligned actions; stacks on small screens. */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: { xs: 'stretch', sm: 'center' },
        mb: 2
      }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
        {subtitle && <Typography sx={{
          color: "text.secondary"
        }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>{actions}</Stack>}
    </Stack>
  );
}

PageHeader.propTypes = {
  title: PropTypes.node.isRequired,
  subtitle: PropTypes.node,
  /** Buttons shown on the right. */
  actions: PropTypes.node,
};
