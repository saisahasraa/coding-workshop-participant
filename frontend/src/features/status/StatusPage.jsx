import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import PropTypes from 'prop-types';
import { getHealth } from '../../api/system';
import useApi from '../../hooks/useApi';
import ToneChip from '../../components/ToneChip';

/** One labelled status tile. */
function StatusTile({ label, value, ok }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" gutterBottom sx={{
          color: "text.secondary"
        }}>{label}</Typography>
        {ok === undefined ? (
          <Typography variant="h3" component="p">{value}</Typography>
        ) : (
          <ToneChip tone={ok ? 'success' : 'error'} label={value} />
        )}
      </CardContent>
    </Card>
  );
}

StatusTile.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  /** When set, renders `value` as a success/error chip. */
  ok: PropTypes.bool,
};

/** System status page: shows API, database and schema health from `GET /health`. */
export default function StatusPage() {
  const { data, error, loading, reload } = useApi(getHealth);
  const schemaOk = data && data.schema_version === data.schema_latest;

  return (
    <Box>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2
        }}>
        <Box>
          <Typography variant="h1">System status</Typography>
          <Typography sx={{
            color: "text.secondary"
          }}>Connectivity from this browser to the API and database.</Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {loading && <LinearProgress aria-label="Checking status" sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          API unreachable: {error.message}
          {error.requestId && ` (request ${error.requestId})`}
        </Alert>
      )}

      {data && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatusTile label="API" value={data.status === 'ok' ? 'Online' : 'Degraded'} ok={data.status === 'ok'} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatusTile label="Database" value={data.database === 'ok' ? 'Connected' : 'Unavailable'} ok={data.database === 'ok'} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatusTile
              label="Database schema"
              value={data.schema_version == null ? 'Unknown' : `v${data.schema_version} of ${data.schema_latest}`}
              ok={Boolean(schemaOk)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatusTile label="Environment" value={`${data.environment} · v${data.version}`} />
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
