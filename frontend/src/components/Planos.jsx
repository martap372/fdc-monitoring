import { useEffect, useMemo, useRef, useState } from 'react';
import StaticTable from './StaticTable';

const API_URL = process.env.REACT_APP_API_URL
	|| `${window.location.protocol}//${window.location.hostname}:5000`;
const MONTHS = [
	'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
	'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const PEOPLE = [
	'André Mota',
	'Daniel Araújo',
	'Emanuel Ferreira',
	'Pedro Freitas',
	'Simão Sá',
];
const CURRENT_YEAR = new Date().getFullYear();
let rememberedMonth = new Date().getMonth();
let rememberedYear = CURRENT_YEAR;
let rememberedSheet = '';

const fileDetails = (filename) => {
	const match = filename.match(/^Planos_(.+)(\d{4})\.xlsx$/);
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

const Planos = () => {
	const fileInput = useRef(null);
	const [files, setFiles] = useState([]);
	const [selectedMonth, setSelectedMonth] = useState(() => rememberedMonth);
	const [selectedYear, setSelectedYear] = useState(() => rememberedYear);
	const [workbook, setWorkbook] = useState(null);
	const [selectedSheet, setSelectedSheet] = useState(() => rememberedSheet);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [importing, setImporting] = useState(false);
	const [showImportDialog, setShowImportDialog] = useState(false);
	const [pendingFile, setPendingFile] = useState(null);
	const [selectedPerson, setSelectedPerson] = useState(PEOPLE[0]);
	useEffect(() => { rememberedMonth = selectedMonth; }, [selectedMonth]);
	useEffect(() => { rememberedYear = selectedYear; }, [selectedYear]);
	useEffect(() => { rememberedSheet = selectedSheet; }, [selectedSheet]);
	const years = useMemo(() => {
		const availableYears = files.map((file) => file.year);
		return [...new Set([CURRENT_YEAR, ...availableYears])].sort((a, b) => b - a);
	}, [files]);
	const selectedFile = files.find((file) => file.month === selectedMonth && file.year === selectedYear);
	const rows = useMemo(() => workbook?.[selectedSheet] || [], [workbook, selectedSheet]);
	const summaryTableData = useMemo(() => {
		const clientRows = rows.slice(1).filter((row) => row.some((value) => value != null && value !== ''));
		return [['Total', clientRows.length]];
	}, [rows]);

	const loadFiles = async () => {
		const response = await fetch(`${API_URL}/api/planos-files`);
		if (!response.ok) throw new Error('Não foi possível carregar os ficheiros de planos.');
		const names = await response.json();
		setFiles(names.map(fileDetails).filter(Boolean));
	};

	const loadWorkbook = async (filename) => {
		const response = await fetch(`${API_URL}/api/planos-files/${encodeURIComponent(filename)}`);
		if (!response.ok) throw new Error('Não foi possível carregar os planos de treino.');
		const data = await response.json();
		setWorkbook(data);
		const firstSheet = Object.keys(data)[0] || '';
		setSelectedSheet((currentSheet) => data[currentSheet] ? currentSheet : firstSheet);
	};

	useEffect(() => {
		loadFiles().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!selectedFile) {
			setWorkbook(null);
			return;
		}
		setLoading(true);
		setError('');
		loadWorkbook(selectedFile.filename).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false));
	}, [selectedFile]);

	const importWorkbook = async () => {
		if (!pendingFile) {
			setError('Escolha um ficheiro para importar.');
			return;
		}
		setImporting(true);
		setError('');
		const formData = new FormData();
		formData.append('file', pendingFile);
		formData.append('person', selectedPerson);
		try {
			const response = await fetch(`${API_URL}/api/planos-import`, { method: 'POST', body: formData });
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível importar o ficheiro.');
			const imported = fileDetails(result.filename);
			await loadFiles();
			if (imported) {
				setSelectedMonth(imported.month);
				setSelectedYear(imported.year);
				await loadWorkbook(result.filename);
			}
			setSelectedSheet(selectedPerson);
			setShowImportDialog(false);
		} catch (importError) {
			setError(importError.message);
			setShowImportDialog(false);
		} finally {
			setImporting(false);
			setPendingFile(null);
			if (fileInput.current) fileInput.current.value = '';
		}
	};

	return (
		<main className="pts-page af-page">
			<section className="pts-toolbar" aria-label="Filtros dos planos de treino">
				<label>Mês<select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>{MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}</select></label>
				<label>Ano<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{years.map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
				<a className="import-button" href={selectedFile ? `${API_URL}/api/planos-files/${encodeURIComponent(selectedFile.filename)}/download` : undefined} download={selectedFile?.filename} aria-disabled={!selectedFile} onClick={(event) => { if (!selectedFile) event.preventDefault(); }}>Exportar</a>
				<button className="import-button" type="button" onClick={() => { setError(''); setPendingFile(null); setShowImportDialog(true); }} disabled={importing}>{importing ? 'A importar...' : 'Importar'}</button>
			</section>
			{error && <div className="af-import-backdrop" role="presentation"><section className="af-import-dialog" role="alertdialog" aria-modal="true" aria-labelledby="planos-error-title"><h2 id="planos-error-title">Erro na importação</h2><p className="pts-error">{error}</p><div className="af-import-actions"><button type="button" onClick={() => setError('')}>Fechar</button></div></section></div>}
			{loading && <p className="pts-status">A carregar...</p>}
			{!loading && !error && !selectedFile && <p className="pts-unavailable">Dados indisponíveis</p>}
			{!loading && !error && workbook && <section className="workbook" aria-label="Planos de treino"><nav className="sheet-tabs" aria-label="Folhas dos planos de treino">{Object.keys(workbook).map((sheet) => <button className={sheet === selectedSheet ? 'active' : ''} type="button" key={sheet} onClick={() => setSelectedSheet(sheet)}>{sheet}</button>)}</nav><div className="spreadsheet-wrap"><table className="static-table af-table"><thead><tr>{rows[0]?.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((value, columnIndex) => <td key={columnIndex}>{value ?? ''}</td>)}</tr>)}</tbody></table><section className="pts-summary" aria-label="Resumo dos planos de treino"><h2>Resumo</h2><StaticTable rows={summaryTableData} titleColumn label={`Resumo dos planos de treino ${selectedSheet}`} /></section></div></section>}
			{showImportDialog && <div className="af-import-backdrop" role="presentation"><section className="af-import-dialog" role="dialog" aria-modal="true" aria-labelledby="planos-import-title"><h2 id="planos-import-title">Importar planos de treino</h2><label>PT<select value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)} disabled={importing}>{PEOPLE.map((person) => <option key={person}>{person}</option>)}</select></label><input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={(event) => setPendingFile(event.target.files[0] || null)} disabled={importing} /><div className="af-import-actions"><button type="button" onClick={() => setShowImportDialog(false)} disabled={importing}>Cancelar</button><button type="button" onClick={importWorkbook} disabled={importing || !pendingFile}>{importing ? 'A importar...' : 'Importar'}</button></div></section></div>}
		</main>
	);
};

export default Planos;