import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataGrid } from '@mui/x-data-grid';

const toSortModel = (sort) => (sort ? sort.split(',').filter(Boolean).map((item) => ({
  field: item.replace(/^-/, ''), sort: item.startsWith('-') ? 'desc' : 'asc',
})) : []);

const fromSortModel = (model) => model.map((item) => `${item.sort === 'desc' ? '-' : ''}${item.field}`).join(',');

/**
 * Server-paginated list: an MUI DataGrid on desktop, a stack of cards on phones.
 * Sorting uses the column `field` as the API sort key.
 */
export default function ResponsiveList({
  rows, total, loading, error, columns, renderCard, page, pageSize, sort, onPageChange, onPageSizeChange,
  onSortChange, onRowClick, emptyText = 'Nothing here yet.',
}) {
  const isMobile = useMediaQuery({ maxWidth: 599 });

  if (error && !rows.length) {
    return <Alert severity="error">{error.message}{error.requestId && ` (request ${error.requestId})`}</Alert>;
  }

  if (isMobile) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return (
      <Box>
        {loading && <LinearProgress aria-label="Loading" sx={{ mb: 1 }} />}
        {!loading && !rows.length && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{emptyText}</Typography>}
        <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {rows.map((row) => (
            <Card key={row.id} component="li">
              {onRowClick ? (
                <CardActionArea onClick={() => onRowClick(row)}><CardContent>{renderCard(row)}</CardContent></CardActionArea>
              ) : <CardContent>{renderCard(row)}</CardContent>}
            </Card>
          ))}
        </Stack>
        {pages > 1 && (
          <Pagination sx={{ mt: 2, display: 'flex', justifyContent: 'center' }} count={pages} page={page + 1}
            onChange={(_e, value) => onPageChange(value - 1)} />
        )}
      </Box>
    );
  }

  return (
    <Card>
      <DataGrid
        rows={rows}
        columns={columns}
        rowCount={total}
        loading={loading}
        autoHeight
        paginationMode="server"
        sortingMode="server"
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={(model) => {
          if (model.pageSize !== pageSize) onPageSizeChange(model.pageSize);
          else onPageChange(model.page);
        }}
        pageSizeOptions={[10, 25, 50, 100]}
        sortModel={toSortModel(sort)}
        onSortModelChange={(model) => onSortChange(fromSortModel(model))}
        onRowClick={onRowClick ? (params) => onRowClick(params.row) : undefined}
        disableRowSelectionOnClick
        disableColumnMenu
        disableVirtualization={import.meta.env.MODE === 'test'}
        localeText={{ noRowsLabel: emptyText }}
        sx={{ border: 0, '& .MuiDataGrid-row': { cursor: onRowClick ? 'pointer' : 'default' } }}
      />
    </Card>
  );
}

ResponsiveList.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  total: PropTypes.number.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.instanceOf(Error),
  /** DataGrid column definitions (desktop). */
  columns: PropTypes.arrayOf(PropTypes.object).isRequired,
  /** Card body for one row (mobile). */
  renderCard: PropTypes.func.isRequired,
  page: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  /** API sort string, e.g. `-due_date`. */
  sort: PropTypes.string,
  onPageChange: PropTypes.func.isRequired,
  onPageSizeChange: PropTypes.func.isRequired,
  onSortChange: PropTypes.func.isRequired,
  onRowClick: PropTypes.func,
  emptyText: PropTypes.string,
};
