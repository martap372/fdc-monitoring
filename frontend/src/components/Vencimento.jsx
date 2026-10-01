import { useCallback, useEffect, useState } from 'react';
import StaticTable from './StaticTable';

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
	useEffect(() => { rememberedSheet = selectedSheet; }, [selectedSheet]);

	const loadWorkbook = useCallback(async () => {
		setLoading(true);
		setError('');
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
			const filesResponse = await fetchFromApi('/api/vencimento-files');
			if (!filesResponse.ok) throw new Error('Não foi possível carregar o ficheiro de vencimentos.');
			const files = await readJson(filesResponse);
			if (!files.length) throw new Error('Não existe um ficheiro de vencimentos.');
			const currentFilename = files[files.length - 1];
			const workbookResponse = await fetchFromApi(
				`/api/vencimento-files/${encodeURIComponent(currentFilename)}`
			);
			if (!workbookResponse.ok) throw new Error('Não foi possível carregar o mapa de vencimentos.');
			const nextWorkbook = await readJson(workbookResponse);
			setWorkbook(nextWorkbook);
			setFilename(currentFilename);
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
	}, []);

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
			{error && <p className="vencimento-error" role="alert">{error}</p>}
			{loading && (
				<p className="vencimento-status" role="status" aria-live="polite">
					{'A carregar...'}
				</p>
			)}
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
						<div className="vencimento-actions">
							{saving && <span className="sheet-saving-status">A guardar...</span>}
							<a
								className="import-button"
								href={filename ? `${API_URLS[0]}/api/vencimento-files/${encodeURIComponent(filename)}/download` : undefined}
								download={filename || undefined}
								aria-disabled={!filename}
								onClick={(event) => { if (!filename) event.preventDefault(); }}
							>
								Exportar
							</a>
						</div>
					</nav>
					<div className="spreadsheet-wrap">
						<StaticTable
							rows={workbook[selectedSheet]?.values || []}
							styles={workbook[selectedSheet]?.styles}
							mergeData={workbook[selectedSheet]?.mergeData}
											numberFormats={isPedroSheet ? { 6: '0', 15: '0.00€' } : isSimaoSheet ? { 6: '0', 14: '0.00€' } : { 6: '0', 13: '0.00€' }}
											editableColumns={editableColumns}
									editableRows={Array.from({ length: 12 }, (_, index) => index + 2)}
									onCellChange={saveCell}
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
