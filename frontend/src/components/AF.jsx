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
	const match = filename.match(/^AF_(.+)(\d{4})\.xlsx$/);
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

const AF = () => {
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
	const [fechosOverride, setFechosOverride] = useState(null);
	const [fechosDraft, setFechosDraft] = useState(null);
	const [summaryError, setSummaryError] = useState('');
	const [savingFechos, setSavingFechos] = useState(false);
	const fechosEditVersion = useRef(0);
	const activeFechosSaves = useRef(0);
	const fechosSaveQueue = useRef(Promise.resolve());
	useEffect(() => { rememberedMonth = selectedMonth; }, [selectedMonth]);
	useEffect(() => { rememberedYear = selectedYear; }, [selectedYear]);
	useEffect(() => { rememberedSheet = selectedSheet; }, [selectedSheet]);
	const years = useMemo(() => {
		const availableYears = files.map((file) => file.year);
		return [...new Set([CURRENT_YEAR, ...availableYears])].sort((a, b) => b - a);
	}, [files]);
	const selectedFile = files.find(
		(file) => file.month === selectedMonth && file.year === selectedYear
	);
	const rows = useMemo(() => workbook?.[selectedSheet] || [], [workbook, selectedSheet]);
	const summaryTableData = useMemo(() => {
		const clientRows = rows.slice(1).filter((row) => row.some((value) => value != null && value !== ''));
		const withPlan = clientRows.filter((row) => String(row[4]).trim() !== '-').length;
		const headers = rows[0] || [];
		const clientPtColumn = headers.indexOf('Cliente PT');
		const fechoColumn = headers.indexOf('Fecho');
		const paidEvaluations = clientRows.filter((row) => (
			(clientPtColumn >= 0 && row[clientPtColumn] === 'Não')
			|| (fechoColumn >= 0 && row[fechoColumn] === 'Sim')
		)).length;
		const calculatedFechos = fechoColumn < 0
			? 0
			: clientRows.filter((row) => row[fechoColumn] === 'Sim').length;
		const fechos = fechosOverride ?? calculatedFechos;
		const percentFecho = paidEvaluations
			? Number((fechos / paidEvaluations).toFixed(4))
			: 0;
		const commissionPerEvaluation =
			percentFecho < 0.1 ? 3 : percentFecho < 0.2 ? 4 : 5
		const afCommission = paidEvaluations * commissionPerEvaluation;
		const percentFechoDisplay = `${(
			paidEvaluations ? (fechos / paidEvaluations) * 100 : 0
		).toFixed(2)}%`;
		return [
			['Avaliações Físicas', clientRows.length],
			['Planos de Treino', withPlan],
			['Em Falta', clientRows.length - withPlan],
			['Avaliações Pagas', `${paidEvaluations} (${afCommission.toFixed(2)}€)`],
			['Fechos', fechos],
			['% Fecho', percentFechoDisplay],
			['Valor por Avaliação', `${(paidEvaluations ? commissionPerEvaluation : 0).toFixed(0)}€`],
		];
	}, [rows, fechosOverride]);

	const loadFiles = async () => {
		const response = await fetch(`${API_URL}/api/af-files`);
		if (!response.ok) throw new Error('Não foi possível carregar os ficheiros AF.');
		const names = await response.json();
		setFiles(names.map(fileDetails).filter(Boolean));
	};

	const loadWorkbook = async (filename) => {
		const response = await fetch(`${API_URL}/api/af-files/${encodeURIComponent(filename)}`);
		if (!response.ok) throw new Error('Não foi possível carregar o mapa de avaliações físicas.');
		const data = await response.json();
		setWorkbook(data);
		const firstSheet = Object.keys(data)[0] || '';
		setSelectedSheet((currentSheet) => data[currentSheet] ? currentSheet : firstSheet);
	};

	useEffect(() => {
		loadFiles()
			.catch((loadError) => setError(loadError.message))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!selectedFile) {
			setWorkbook(null);
			return;
		}
		setLoading(true);
		setError('');
		loadWorkbook(selectedFile.filename)
			.catch((loadError) => setError(loadError.message))
			.finally(() => setLoading(false));
	}, [selectedFile]);

	useEffect(() => {
		if (!selectedFile || !selectedSheet) {
			setFechosOverride(null);
			setFechosDraft(null);
			return undefined;
		}
		let cancelled = false;
		const loadVersion = fechosEditVersion.current;
		setFechosOverride(null);
		setFechosDraft(null);
		setSummaryError('');
		fetch(`${API_URL}/api/af-files/${encodeURIComponent(selectedFile.filename)}/fechos?sheet=${encodeURIComponent(selectedSheet)}`)
			.then(async (response) => {
				const result = await readJson(response);
				if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os Fechos.');
				if (!cancelled && loadVersion === fechosEditVersion.current) {
					setFechosOverride(result.value);
					setFechosDraft(result.value == null ? null : String(result.value));
				}
			})
			.catch((loadError) => {
				if (!cancelled) setSummaryError(loadError.message);
			});
		return () => { cancelled = true; };
	}, [selectedFile, selectedSheet]);

	const persistFechos = async ({ value, filename, sheet, version }) => {
		activeFechosSaves.current += 1;
		setSavingFechos(true);
		if (version === fechosEditVersion.current) setSummaryError('');
		try {
			const response = await fetch(
				`${API_URL}/api/af-files/${encodeURIComponent(filename)}/fechos`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sheet, value }),
				}
			);
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível guardar os Fechos.');
			if (
				version === fechosEditVersion.current
				&& selectedFile?.filename === filename
				&& selectedSheet === sheet
			) {
				setFechosOverride(result.value);
				setFechosDraft(String(result.value));
			}
		} catch (saveError) {
			if (version === fechosEditVersion.current) setSummaryError(saveError.message);
		} finally {
			activeFechosSaves.current -= 1;
			setSavingFechos(activeFechosSaves.current > 0);
		}
	};

	const handleFechosInput = (value) => {
		const version = ++fechosEditVersion.current;
		setFechosDraft(value);
		if (/^\d+$/.test(value)) {
			setFechosOverride(Number(value));
			const pending = {
				value,
				filename: selectedFile.filename,
				sheet: selectedSheet,
				version,
			};
			fechosSaveQueue.current = fechosSaveQueue.current.then(
				() => persistFechos(pending),
				() => persistFechos(pending),
			);
		}
	};

	const commitFechosInput = () => {
		if (!/^\d+$/.test(fechosDraft ?? '')) {
			setFechosDraft(String(fechosOverride ?? summaryTableData[4]?.[1] ?? 0));
		}
	};

	const openImportDialog = () => {
		setError('');
		setPendingFile(null);
		setShowImportDialog(true);
	};

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
			const response = await fetch(`${API_URL}/api/af-import`, { method: 'POST', body: formData });
			const result = await readJson(response);
			if (!response.ok) throw new Error(result.error || 'Não foi possível importar o ficheiro.');
			const imported = fileDetails(result.filename);
			await loadFiles();
			if (imported) {
				setSelectedMonth(imported.month);
				setSelectedYear(imported.year);
			}
			await loadWorkbook(result.filename);
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
			<section className="pts-toolbar" aria-label="Filtros das avaliações físicas">
				<label>
					Mês
					<select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
						{MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}
					</select>
				</label>
				<label>
					Ano
					<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
						{years.map((year) => <option value={year} key={year}>{year}</option>)}
					</select>
				</label>
				<a
					className="import-button"
					href={selectedFile ? `${API_URL}/api/af-files/${encodeURIComponent(selectedFile.filename)}/download` : undefined}
					download={selectedFile?.filename}
					aria-disabled={!selectedFile}
					onClick={(event) => { if (!selectedFile) event.preventDefault(); }}
				>
					Exportar
				</a>
				<button className="import-button" type="button" onClick={openImportDialog} disabled={importing}>
					{importing ? 'A importar...' : 'Importar'}
				</button>
			</section>

			{error && (
				<div className="af-import-backdrop" role="presentation">
					<section className="af-import-dialog" role="alertdialog" aria-modal="true" aria-labelledby="af-error-title">
						<h2 id="af-error-title">Erro na importação</h2>
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
				<section className="workbook" aria-label="Avaliações físicas">
					<nav className="sheet-tabs" aria-label="Folhas das avaliações físicas">
						{Object.keys(workbook).map((sheet) => (
							<button className={sheet === selectedSheet ? 'active' : ''} type="button" key={sheet} onClick={() => setSelectedSheet(sheet)}>
								{sheet}
							</button>
						))}
					</nav>
					<div className="spreadsheet-wrap">
						<table className="static-table af-table">
							<thead>
								<tr>{rows[0]?.map((header) => <th key={header}>{header}</th>)}</tr>
							</thead>
							<tbody>
								{rows.slice(1).map((row, rowIndex) => (
									<tr key={`${row[0]}-${rowIndex}`}>
										{row.map((value, columnIndex) => (
											<td key={columnIndex}>
														{columnIndex === 4 ? (value || '-') : value ?? ''}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
						<section className="pts-summary af-summary" aria-label="Resumo das avaliações físicas">
							<h2>Resumo</h2>
							<StaticTable
								key={`${selectedFile.filename}-${selectedSheet}`}
								rows={summaryTableData}
								titleColumn
								label={`Resumo das avaliações físicas ${selectedSheet}`}
								editableColumns={[1]}
								editableRows={[4]}
								inputValues={{ '4:1': fechosDraft ?? summaryTableData[4]?.[1] ?? 0 }}
								onCellInput={handleFechosInput}
								onCellChange={commitFechosInput}
							/>
							{savingFechos && <p className="pts-status">A guardar...</p>}
							{summaryError && <p className="pts-error" role="alert">{summaryError}</p>}
						</section>
					</div>
				</section>
			)}

			{showImportDialog && (
				<div className="af-import-backdrop" role="presentation">
					<section className="af-import-dialog" role="dialog" aria-modal="true" aria-labelledby="af-import-title">
						<h2 id="af-import-title">Importar avaliações físicas</h2>
						<label>
							PT
							<select value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)} disabled={importing}>
								{PEOPLE.map((person) => <option key={person}>{person}</option>)}
							</select>
						</label>
						<input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={(event) => setPendingFile(event.target.files[0] || null)} disabled={importing} />
						<div className="af-import-actions">
							<button type="button" onClick={() => setShowImportDialog(false)} disabled={importing}>Cancelar</button>
							<button type="button" onClick={importWorkbook} disabled={importing || !pendingFile}>{importing ? 'A importar...' : 'Importar'}</button>
						</div>
					</section>
				</div>
			)}
		</main>
	);
};

export default AF;
