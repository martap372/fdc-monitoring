import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4


def convert_xls(filename):
	"""Convert an XLS file to XLSX with LibreOffice and return the new filename."""
	input_path = Path(filename)
	if input_path.suffix.lower() != '.xls':
		return str(input_path), False

	backend_dir = input_path.parent
	token = uuid4().hex
	converted_name = f'.converted_{token}.xlsx'
	with tempfile.TemporaryDirectory(prefix='xls-conversion-', dir=backend_dir) as temporary_dir:
		temporary_input = Path(temporary_dir) / f'input_{token}.xls'
		shutil.copy2(input_path, temporary_input)
		result = subprocess.run(
			[
				'libreoffice', '--headless', '--convert-to', 'xlsx',
				'--outdir', temporary_dir, str(temporary_input),
			],
			capture_output=True,
			text=True,
			timeout=120,
		)
		converted_path = Path(temporary_dir) / f'input_{token}.xlsx'
		if result.returncode != 0 or not converted_path.exists():
			details = result.stderr.strip() or result.stdout.strip()
			raise RuntimeError(f'Não foi possível converter o ficheiro XLS.{f" {details}" if details else ""}')
		shutil.copy2(converted_path, backend_dir / converted_name)

	return str(backend_dir / converted_name), True
