import { useEffect, useMemo, useRef, useState } from 'react';
import StaticTable from './StaticTable';

const API_URL = process.env.REACT_APP_API_URL
	|| `${window.location.protocol}//${window.location.hostname}:5000`;
const MONTHS = [
	'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
	'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const CURRENT_YEAR = new Date().getFullYear();
let rememberedMonth = new Date().getMonth();
let rememberedYear = CURRENT_YEAR;
let rememberedSheet = '';

const formatSummaryAmount = (value) => (
	typeof value === 'number' ? `${value.toFixed(2)}€` : value
);

const fileDetails = (filename) => {
	const match = filename.match(/^PT_(.+)(\d{4})\.xlsx$/);
	if (!match) return null;
	const month = MONTHS.indexOf(match[1]);
	return month < 0 ? null : { filename, month, year: Number(match[2]) };
};

const readJson = async (response) => {
	const body = await response.text();
	try {
		return JSON.parse(body);
	} catch (parseError) {
		throw new Error(`O servidor devolveu uma resposta inválida (${response.status}).`);
	}
};

const PTs = () => {
	const fileInput = useRef(null);
	const [files, setFiles] = useState([]);
	const [selectedMonth, setSelectedMonth] = useState(() => rememberedMonth);
	const [selectedYear, setSelectedYear] = useState(() => rememberedYear);
	const [workbook, setWorkbook] = useState(null);
	const [selectedSheet, setSelectedSheet] = useState(() => rememberedSheet);
	const [sheetData, setSheetData] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [importing, setImporting] = useState(false);
	const [saving, setSaving] = useState(false);
	const [adding, setAdding] = useState(false);
	const [editingRow, setEditingRow] = useState(null);
	const [newRow, setNewRow] = useState({ memberNumber: '', clientName: '', contract: '', hours: '', amount: '', percentage: '', trainingsDone: '' });
	useEffect(() => { rememberedMonth = selectedMonth; }, [selectedMonth]);
	useEffect(() => { rememberedYear = selectedYear; }, [selectedYear]);
	useEffect(() => { rememberedSheet = selectedSheet; }, [selectedSheet]);
	const mainTableData = useMemo(() => {
		const rows = sheetData.map((row) => row.slice(0, 14));
		const lastContentRow = rows.findLastIndex((row) => row.some((value) => value != null && value !== ''));
		return rows.slice(0, lastContentRow + 1);
	}, [sheetData]);
	const summaryTableData = useMemo(() => {
		const summaryRows = sheetData.slice(1).map((row) => {
			const summaryRow = row.slice(15, 18);
			const combinedValue = summaryRow[2] != null
				? `${summaryRow[1] ?? ''} (${formatSummaryAmount(summaryRow[2])})`
				: summaryRow[1];
			return [summaryRow[0], combinedValue];
		});
		const lastContentRow = summaryRows.findLastIndex((row) => row.some((value) => value != null && value !== ''));
		return summaryRows.slice(0, lastContentRow + 1);
	}, [sheetData]);
	const years = useMemo(() => {
		const availableYears = files.map((file) => file.year);
		return [...new Set([CURRENT_YEAR, ...availableYears])].sort((a, b) => b - a);
	}, [files]);

	const selectedFile = files.find(
		(file) => file.month === selectedMonth && file.year === selectedYear
	);

	const loadFiles = async () => {
		const response = await fetch(`${API_URL}/api/pt-files`);
		if (!response.ok) throw new Error('Não foi possível carregar os ficheiros PT.');
		const names = await response.json();
		setFiles(names.map(fileDetails).filter(Boolean));
	};

	useEffect(() => {
		loadFiles()
			.catch((loadError) => setError(loadError.message))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!selectedFile) {
			setWorkbook(null);
			setSheetData([]);
			return;
		}

		setLoading(true);
		setError('');
		fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}`)
			.then((response) => {
				if (!response.ok) throw new Error('Não foi possível carregar o mapa PT.');
				return response.json();
			})
			.then((data) => {
				setWorkbook(data);
				const firstSheet = Object.keys(data)[0] || '';
				const sheet = data[rememberedSheet] ? rememberedSheet : firstSheet;
				setSelectedSheet(sheet);
				setSheetData(data[sheet] || []);
			})
			.catch((loadError) => setError(loadError.message))
			.finally(() => setLoading(false));
	}, [selectedFile]);

	const importWorkbook = async (event) => {
		const [file] = event.target.files;
		if (!file) return;

		setImporting(true);
		setError('');
		const formData = new FormData();
		formData.append('file', file);
		try {
			const response = await fetch(`${API_URL}/api/pt-import`, {
				method: 'POST',
				body: formData,
			});
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível importar o ficheiro.');
			const imported = fileDetails(result.filename);
			await loadFiles();
			if (imported) {
				setSelectedMonth(imported.month);
				setSelectedYear(imported.year);
			}
		} catch (importError) {
			setError(importError.message);
		} finally {
			setImporting(false);
			event.target.value = '';
		}
	};

	const saveCell = async (value, row, column) => {
		if (!selectedFile || column !== 9) return;
		setSaving(true);
		setError('');
		try {
			const response = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}/cells`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sheet: selectedSheet, row, column, value }),
			});
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível guardar a célula.');
			const refreshedResponse = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}`);
			if (!refreshedResponse.ok) throw new Error('Não foi possível atualizar o mapa PT.');
			const refreshedWorkbook = await refreshedResponse.json();
			setWorkbook(refreshedWorkbook);
			setSheetData(refreshedWorkbook[selectedSheet] || []);
		} catch (saveError) {
			setError(saveError.message);
		} finally {
			setSaving(false);
		}
	};

	const addRow = async (event) => {
		event.preventDefault();
		if (!selectedFile) return;
		setSaving(true);
		setError('');
		try {
			const response = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}/rows`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sheet: selectedSheet, ...newRow }),
			});
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível adicionar a linha.');
			const refreshedResponse = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}`);
			if (!refreshedResponse.ok) throw new Error('Não foi possível atualizar o mapa PT.');
			const refreshedWorkbook = await refreshedResponse.json();
			setWorkbook(refreshedWorkbook);
			setSheetData(refreshedWorkbook[selectedSheet] || []);
			setNewRow({ memberNumber: '', clientName: '', contract: '', hours: '', amount: '', percentage: '', trainingsDone: '' });
			setAdding(false);
		} catch (addError) {
			setError(addError.message);
		} finally {
			setSaving(false);
		}
	};

	const startEditingRow = (rowIndex, row) => {
		setNewRow({
			memberNumber: String(row[0] ?? ''),
			clientName: String(row[1] ?? ''),
			contract: String(row[2] ?? ''),
			hours: String(row[3] ?? ''),
			amount: String(row[5] ?? ''),
			percentage: String(typeof row[6] === 'number' ? row[6] * 100 : row[6] ?? ''),
			trainingsDone: String(row[9] ?? ''),
		});
		setAdding(false);
		setEditingRow(rowIndex);
	};

	const updateRow = async (event) => {
		event.preventDefault();
		if (!selectedFile || editingRow == null) return;
		setSaving(true);
		setError('');
		try {
			const response = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}/rows/${editingRow}?sheet=${encodeURIComponent(selectedSheet)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newRow),
			});
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar a linha.');
			const refreshedResponse = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}`);
			if (!refreshedResponse.ok) throw new Error('Não foi possível atualizar o mapa PT.');
			const refreshedWorkbook = await refreshedResponse.json();
			setWorkbook(refreshedWorkbook);
			setSheetData(refreshedWorkbook[selectedSheet] || []);
			setEditingRow(null);
			setNewRow({ memberNumber: '', clientName: '', contract: '', hours: '', amount: '', percentage: '', trainingsDone: '' });
		} catch (updateError) {
			setError(updateError.message);
		} finally {
			setSaving(false);
		}
	};

	const deleteRow = async (row) => {
		if (!selectedFile || !window.confirm('Remover cliente?')) return;
		setSaving(true);
		setError('');
		try {
			const response = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}/rows/${row}?sheet=${encodeURIComponent(selectedSheet)}`, { method: 'DELETE' });
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível remover cliente.');
			const refreshedResponse = await fetch(`${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}`);
			if (!refreshedResponse.ok) throw new Error('Não foi possível atualizar o mapa PT.');
			const refreshedWorkbook = await refreshedResponse.json();
			setWorkbook(refreshedWorkbook);
			setSheetData(refreshedWorkbook[selectedSheet] || []);
		} catch (deleteError) {
			setError(deleteError.message);
		} finally {
			setSaving(false);
		}
	};

	const addedRows = useMemo(() => new Set(
		sheetData.map((row, rowIndex) => row[14] === 'added' ? rowIndex : null).filter((rowIndex) => rowIndex != null),
	), [sheetData]);
	const renderRowForm = (onSubmit, submitLabel) => (
		<form className="pt-add-row" onSubmit={onSubmit}>
			{[
				['memberNumber', 'Nº Sócio', 'text'], ['clientName', 'Nome do Cliente', 'text'], ['contract', 'Contrato', 'text'],
				['hours', 'Horas', 'number'], ['amount', 'Valor c/iva', 'number'], ['percentage', '%', 'number'], ['trainingsDone', 'Treinos Dados', 'number'],
			].map(([field, label, type]) => (
				<label key={field}>{label}<input required type={type} min="0" max={field === 'percentage' ? 100 : undefined} step={type === 'number' ? 'any' : undefined} value={newRow[field]} onChange={(event) => setNewRow((current) => ({ ...current, [field]: event.target.value }))} /></label>
			))}
			<div className="pt-add-row-actions"><button type="submit" disabled={saving}>{submitLabel}</button><button type="button" onClick={() => { setAdding(false); setEditingRow(null); }} disabled={saving}>Cancelar</button></div>
		</form>
	);

	return (
		<main className="pts-page">
			<section className="pts-toolbar" aria-label="Filtros do mapa">
				<label>
					Mês
					<select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))} disabled={saving || editingRow != null}>
						{MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}
					</select>
				</label>
				<label>
					Ano
					<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))} disabled={saving || editingRow != null}>
						{years.map((year) => <option value={year} key={year}>{year}</option>)}
					</select>
				</label>
				<a
					className="import-button"
					href={selectedFile ? `${API_URL}/api/pt-files/${encodeURIComponent(selectedFile.filename)}/download` : undefined}
					download={selectedFile?.filename}
					aria-disabled={!selectedFile || saving}
					tabIndex={selectedFile && !saving ? 0 : -1}
					onClick={(event) => { if (!selectedFile || saving) event.preventDefault(); }}
				>
					Exportar
				</a>
				<button className="import-button" type="button" onClick={() => fileInput.current?.click()} disabled={importing || saving}>
					{importing ? 'A importar...' : 'Importar'}
				</button>
				<input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={importWorkbook} hidden />
			</section>

			{error && (
				<div className="af-import-backdrop" role="presentation">
					<section className="af-import-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pts-error-title">
						<h2 id="pts-error-title">Erro na importação</h2>
						<p className="pts-error">{error}</p>
						<div className="af-import-actions">
							<button type="button" onClick={() => setError('')}>Fechar</button>
						</div>
					</section>
				</div>
			)}
			{loading && <p className="pts-status">A carregar...</p>}
			{!loading && !error && !selectedFile && <p className="pts-unavailable">Dados indisponíveis</p>}
			{!loading && !error && workbook && (
				<section className="workbook" aria-label="Mapa PT">
					<nav className="sheet-tabs" aria-label="Folhas do mapa">
						{Object.keys(workbook).map((sheet) => (
									<button className={sheet === selectedSheet ? 'active' : ''} type="button" key={sheet} onClick={() => {
								setSelectedSheet(sheet);
								setSheetData(workbook[sheet] || []);
											}} disabled={saving || editingRow != null}>
								{sheet}
							</button>
						))}
							{saving && <span className="sheet-saving-status">A guardar...</span>}
					</nav>
					<div className="spreadsheet-wrap">
						<StaticTable
							rows={mainTableData}
							numberFormats={{ 5: '0.00€', 6: '0%', 7: '0.00€', 10: '0.00€', 11: '0.00€', 13: '0.00€' }}
							editableColumns={[9]}
							onCellChange={saveCell}
							disabled={saving}
							label={`Folha ${selectedSheet}`}
							rowActionColumnCount={2}
							rowActions={(row, rowIndex) => addedRows.has(rowIndex) ? (
								<>
									<td className="static-table-action-cell"><button className="edit-row-button" type="button" onClick={() => startEditingRow(rowIndex, row)} disabled={saving || editingRow != null}>Editar</button></td>
									<td className="static-table-action-cell"><button className="remove-row-button" type="button" onClick={() => deleteRow(rowIndex)} disabled={saving || editingRow != null}>Remover</button></td>
								</>
							) : null}
							rowDetails={(_, rowIndex) => editingRow === rowIndex ? renderRowForm(updateRow, 'Guardar') : null}
						/>
						{adding ? renderRowForm(addRow, 'Adicionar') : editingRow == null && <button className="add-row-button" type="button" onClick={() => { setNewRow({ memberNumber: '', clientName: '', contract: '', hours: '', amount: '', percentage: '', trainingsDone: '' }); setAdding(true); }} disabled={saving}>Adicionar cliente</button>}
						<section className="pts-summary" aria-label="Resumo da folha">
							<h2>Resumo</h2>
							<StaticTable
								rows={summaryTableData}
								numberFormats={{ '2:1': '0.00€', '7:1': '0.00€' }}
								titleColumn
								boldRowLabels={['A receber']}
								label={`Resumo da folha ${selectedSheet}`}
							/>
						</section>
					</div>
				</section>
			)}
		</main>
	);
};

export default PTs;
