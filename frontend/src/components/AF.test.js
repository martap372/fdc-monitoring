import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AF from './AF';

const afWorkbook = {
	'André Mota': [
		[
			'Nº de Sócio', 'Nome do Cliente', 'Nº Avaliação', 'Avaliação Física',
			'Plano de Treino', 'Dias de Diferença', 'Cliente PT', 'Fecho',
		],
		[123, 'Cliente', 1, '10-01-2024', '-', '-', 'Sim', 'Sim'],
		[456, 'Outro Cliente', 2, '11-01-2024', '-', '-', 'Sim', 'Não'],
	],
};

const response = (value) => ({
	ok: true,
	json: async () => value,
	text: async () => JSON.stringify(value),
});

describe('AF Fecho selection', () => {
	const originalFetch = global.fetch;

	const mockAfRequests = (workbook) => {
		let fechosOverride = null;
		const rowFechos = new Map(
			workbook['André Mota'].slice(1).map((row, index) => [index + 1, row[7]]),
		);
		global.fetch = jest.fn((url, options = {}) => {
			if (url.endsWith('/api/af-files')) {
				return Promise.resolve(response(['AF_Janeiro2024.xlsx']));
			}
			if (url.endsWith('/api/af-files/AF_Janeiro2024.xlsx')) {
				return Promise.resolve(response(workbook));
			}
			if (url.includes('/api/af-files/AF_Janeiro2024.xlsx/fechos?')) {
				return Promise.resolve(response({ value: fechosOverride }));
			}
			if (url.endsWith('/api/af-files/AF_Janeiro2024.xlsx/fechos') && options.method === 'PUT') {
				fechosOverride = JSON.parse(options.body).value;
				return Promise.resolve(response({ value: fechosOverride }));
			}
			if (url.endsWith('/api/af-files/AF_Janeiro2024.xlsx/cells') && options.method === 'PUT') {
				const update = JSON.parse(options.body);
				if (fechosOverride != null && update.column === 7) {
					const previousValue = rowFechos.get(update.row);
					fechosOverride = Math.max(
						0,
						fechosOverride + Number(update.value === 'Sim') - Number(previousValue === 'Sim'),
					);
					rowFechos.set(update.row, update.value);
				}
				return Promise.resolve(response({
					...update,
					fechos_override: fechosOverride,
				}));
			}
			throw new Error(`Unexpected request: ${url}`);
		});
	};

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('saves a selected Fecho and updates the Resumo count', async () => {
		mockAfRequests(afWorkbook);

		render(<AF />);

		await screen.findByText('Janeiro');
		fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '0' } });
		fireEvent.change(screen.getByLabelText('Ano'), { target: { value: '2024' } });

		const fechoSelect = await screen.findByLabelText('Fecho de Outro Cliente');
		const fechosSummaryRow = screen.getByText('Fechos').closest('tr');
		expect(within(fechosSummaryRow).getByRole('spinbutton')).toHaveValue(1);

		fireEvent.change(fechoSelect, { target: { value: 'Sim' } });

		await waitFor(() => {
			expect(within(fechosSummaryRow).getByRole('spinbutton')).toHaveValue(2);
		});
		const updateRequest = global.fetch.mock.calls.find(([, options]) => options?.method === 'PUT');
		expect(JSON.parse(updateRequest[1].body)).toEqual({
			sheet: 'André Mota',
			row: 2,
			column: 7,
			value: 'Sim',
		});
	});

	it('counts paid evaluations only when they have a plan', async () => {
		mockAfRequests({
			'André Mota': [
				afWorkbook['André Mota'][0],
				[123, 'PT Não sem plano', 1, '10-01-2024', '-', '-', 'Não', 'Não'],
				[456, 'PT Não com plano', 2, '11-01-2024', 'Plano', '-', 'Não', 'Não'],
				[789, 'Fecho sem plano', 3, '12-01-2024', '-', '-', 'Sim', 'Sim'],
				[101, 'Fecho com plano', 4, '13-01-2024', 'Plano', '-', 'Sim', 'Sim'],
			],
		});

		render(<AF />);
		await screen.findByText('Janeiro');
		fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '0' } });
		fireEvent.change(screen.getByLabelText('Ano'), { target: { value: '2024' } });

		const paidSummaryRow = await screen.findByText('Avaliações Pagas').then(
			(label) => label.closest('tr'),
		);
		expect(within(paidSummaryRow).getByText('2 (10.00€)')).toBeInTheDocument();
	});

	it('increments a manually set Fechos total when a client is changed to Sim', async () => {
		mockAfRequests(afWorkbook);
		render(<AF />);
		await screen.findByText('Janeiro');
		fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '0' } });
		fireEvent.change(screen.getByLabelText('Ano'), { target: { value: '2024' } });

		const fechosSummaryRow = await screen.findByText('Fechos').then(
			(label) => label.closest('tr'),
		);
		const fechosInput = within(fechosSummaryRow).getByRole('spinbutton');
		fireEvent.change(fechosInput, { target: { value: '5' } });
		await waitFor(() => expect(fechosInput).toHaveValue(5));

		fireEvent.change(screen.getByLabelText('Fecho de Outro Cliente'), { target: { value: 'Sim' } });
		await waitFor(() => expect(fechosInput).toHaveValue(6));
	});
});
