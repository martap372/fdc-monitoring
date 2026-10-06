import { useCallback, useEffect, useMemo, useState } from 'react';
import StaticTable from './StaticTable';

const MONTHS = [
	'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
	'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const CURRENT_YEAR = new Date().getFullYear();
let rememberedYear = CURRENT_YEAR;

const API_HOST = window.location.hostname || 'localhost';
const API_URLS = process.env.REACT_APP_API_URL
	? [process.env.REACT_APP_API_URL]
	: [...new Set([
		`http://${API_HOST}:5000`,
		'http://localhost:5000',
		'http://127.0.0.1:5000',
	])];

const fetchFromApi = async (path, options) => {
	let lastError;
	for (const apiUrl of API_URLS) {
		try {
			const response = await fetch(`${apiUrl}${path}`, options);
			return response;
		} catch (requestError) {
			lastError = requestError;
		}
	}
	throw lastError || new Error('Não foi possível ligar ao servidor.');
};

const readJson = async (response) => {
	const body = await response.text();
	try {
		return JSON.parse(body);
	} catch (parseError) {
		throw new Error(`O servidor devolveu uma resposta inválida (${response.status}).`);
	}
};

let rememberedSheet = '';

const Vencimento = () => {
	const [files, setFiles] = useState([]);
	const [selectedMonth, setSelectedMonth] = useState(null);
	const [selectedYear, setSelectedYear] = useState(() => rememberedYear);
	const [workbook, setWorkbook] = useState(null);
	const [filename, setFilename] = useState('');
	const [selectedSheet, setSelectedSheet] = useState(() => rememberedSheet);
	const [loading, setLoading] = useState(true);
	const [, setBackgroundUpdating] = useState(false);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const isPedroSheet = selectedSheet === 'Pedro Freitas';
	const isSimaoSheet = selectedSheet === 'Simão Sá';
	const isWideSheet = isPedroSheet || isSimaoSheet;
	const editableColumns = isPedroSheet ? [12, 15] : isSimaoSheet ? [14] : [13];
	useEffect(() => { rememberedYear = selectedYear; }, [selectedYear]);
	useEffect(() => { rememberedSheet = selectedSheet; }, [selectedSheet]);
	const years = useMemo(() => (
		[...new Set([CURRENT_YEAR, ...files.map((file) => file.year)])].sort((a, b) => b - a)
	), [files]);
	const selectedFile = files.find((file) => file.year === selectedYear);
	const tableRows = useMemo(() => {
		const rows = workbook?.[selectedSheet]?.values || [];
		if (selectedMonth === null) return rows;
		if (rows.length < 2) return rows;
		const monthRow = rows[selectedMonth + 2];
		return monthRow ? [...rows.slice(0, 2), monthRow] : rows.slice(0, 2);
	}, [workbook, selectedSheet, selectedMonth]);
	const tableStyles = useMemo(() => {
		const styles = workbook?.[selectedSheet]?.styles || [];
		if (selectedMonth === null) return styles;
		if (styles.length < 2) return styles;
		const monthStyles = styles[selectedMonth + 2];
		return monthStyles ? [...styles.slice(0, 2), monthStyles] : styles.slice(0, 2);
	}, [workbook, selectedSheet, selectedMonth]);

	const loadWorkbook = useCallback(async () => {
		setLoading(true);
		setError('');
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
			const filesResponse = await fetchFromApi('/api/vencimento-files');
			if (!filesResponse.ok) throw new Error('Não foi possível carregar o ficheiro de vencimentos.');
			const filenames = await readJson(filesResponse);
			const nextFiles = filenames.map((name) => {
				const match = name.match(/^Vencimento_(\d{4})\.xlsx$/);
				return match ? { filename: name, year: Number(match[1]) } : null;
			}).filter(Boolean);
			setFiles(nextFiles);
			const currentFile = nextFiles.find((file) => file.year === selectedYear);
			if (!currentFile) {
				setWorkbook(null);
				setFilename('');
				setLoading(false);
				return;
			}
			const workbookResponse = await fetchFromApi(
				`/api/vencimento-files/${encodeURIComponent(currentFile.filename)}`
			);
			if (!workbookResponse.ok) throw new Error('Não foi possível carregar o mapa de vencimentos.');
			const nextWorkbook = await readJson(workbookResponse);
			setWorkbook(nextWorkbook);
			setFilename(currentFile.filename);
			setSelectedSheet((currentSheet) => (
				currentSheet && nextWorkbook[currentSheet]
					? currentSheet
					: Object.keys(nextWorkbook)[0] || ''
			));
			setLoading(false);
			return;
			} catch (loadError) {
				if (attempt === 2) {
					setError(`Não foi possível ligar ao servidor de vencimentos: ${loadError.message}`);
					setLoading(false);
					return;
				}
			}
		}
	}, [selectedYear]);

	const saveCell = async (value, row, column) => {
		if (!filename || !editableColumns.includes(column)) return;
		setSaving(true);
		setError('');
		try {
			const response = await fetchFromApi(
				`/api/vencimento-files/${encodeURIComponent(filename)}/cells`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sheet: selectedSheet, row, column, value }),
				}
			);
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível guardar o valor.');
			await loadWorkbook();
		} catch (saveError) {
			setError(saveError.message);
		} finally {
			setSaving(false);
		}
	};

	useEffect(() => {
		let stopped = false;
		let timer;
		let previousRevision = null;
		let observedUpdate = false;
		let initialLoadStarted = false;

		const checkForUpdates = async () => {
			try {
				const response = await fetchFromApi('/api/vencimento-status');
				if (!response.ok) throw new Error('Não foi possível verificar as atualizações.');
				const status = await readJson(response);
				const revisionChanged = (
					previousRevision !== null && status.revision !== previousRevision
				);
				const firstCheck = previousRevision === null;
				previousRevision = status.revision;

				if (status.updating) {
					observedUpdate = true;
					setBackgroundUpdating(true);
					setLoading(true);
				} else if (firstCheck || observedUpdate || revisionChanged) {
					observedUpdate = false;
					setBackgroundUpdating(false);
					initialLoadStarted = true;
					await loadWorkbook();
				}
			} catch (statusError) {
				if (!initialLoadStarted) {
					initialLoadStarted = true;
					await loadWorkbook();
				}
			} finally {
				if (!stopped) timer = window.setTimeout(checkForUpdates, 1000);
			}
		};

		checkForUpdates();
		return () => {
			stopped = true;
			window.clearTimeout(timer);
		};
	}, [loadWorkbook]);

	return (
		<main className="vencimento-page">
			<section className="pts-toolbar vencimento-toolbar" aria-label="Filtros dos vencimentos">
				<label>Mês<select value={selectedMonth ?? ''} onChange={(event) => setSelectedMonth(event.target.value === '' ? null : Number(event.target.value))}><option value="">-</option>{MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}</select></label>
				<label>Ano<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{years.map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
				<a
					className="import-button"
					href={selectedFile ? `${API_URLS[0]}/api/vencimento-files/${encodeURIComponent(selectedFile.filename)}/download` : undefined}
					download={selectedFile?.filename}
					aria-disabled={!selectedFile}
					onClick={(event) => { if (!selectedFile) event.preventDefault(); }}
				>
					Exportar
				</a>
			</section>
			{error && <p className="vencimento-error" role="alert">{error}</p>}
			{loading && (
				<p className="vencimento-status" role="status" aria-live="polite">
					{'A carregar...'}
				</p>
			)}
			{!loading && !error && !workbook && <p className="pts-unavailable">Dados indisponíveis</p>}
			{!loading && workbook && (
					<section className={`vencimento-workbook${isWideSheet ? ' vencimento-workbook-wide' : ''}`} aria-label="Mapa de vencimentos">
					<nav className="sheet-tabs" aria-label="Folhas de vencimentos">
						{Object.keys(workbook).map((sheet) => (
							<button
								className={sheet === selectedSheet ? 'active' : ''}
								type="button"
								key={sheet}
								onClick={() => setSelectedSheet(sheet)}
								disabled={saving}
							>
								{sheet}
							</button>
						))}
						{saving && <span className="sheet-saving-status">A guardar...</span>}
					</nav>
					<div className="spreadsheet-wrap">
						<StaticTable
							rows={tableRows}
							styles={tableStyles}
							mergeData={workbook[selectedSheet]?.mergeData}
											numberFormats={isPedroSheet ? { 6: '0', 15: '0.00€' } : isSimaoSheet ? { 6: '0', 14: '0.00€' } : { 6: '0', 13: '0.00€' }}
											editableColumns={editableColumns}
											editableRows={selectedMonth === null ? Array.from({ length: 12 }, (_, index) => index + 2) : [2]}
											onCellChange={(value, row, column) => saveCell(value, selectedMonth === null ? row : selectedMonth + row, column)}
								disabled={saving}
							label={`Folha ${selectedSheet}`}
							sectionDividerColumns={isPedroSheet ? [0, 4, 8, 11, 13] : [0, 4, 8, 11]}
							euroInputColumns={isPedroSheet ? [15] : isSimaoSheet ? [14] : [13]}
						/>
					</div>
				</section>
			)}
		</main>
	);
};

export default Vencimento;
