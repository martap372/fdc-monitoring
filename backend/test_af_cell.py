import os
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook, load_workbook

import app


class UpdateAfCellTests(unittest.TestCase):
	def setUp(self):
		self.temporary_dir = tempfile.TemporaryDirectory()
		self.filename = 'AF_Janeiro2024.xlsx'
		self.workbook_path = os.path.join(self.temporary_dir.name, self.filename)
		workbook = Workbook()
		worksheet = workbook.active
		worksheet.title = 'André Mota'
		worksheet.append([
			'Nº de Sócio', 'Nome do Cliente', 'Nº Avaliação', 'Avaliação Física',
			'Plano de Treino', 'Dias de Diferença', 'Cliente PT', 'Fecho',
		])
		worksheet.append([123, 'Cliente', 1, '10-01-2024', '-', '-', 'Sim', 'Não'])
		workbook.save(self.workbook_path)
		workbook.close()

		self.patches = [
			patch.object(app, 'BACKEND_DIR', self.temporary_dir.name),
			patch.object(app, 'af_files', return_value=[self.filename]),
			patch.object(app, 'generate_vencimento'),
		]
		for patcher in self.patches:
			patcher.start()
		self.client = app.app.test_client()

	def tearDown(self):
		for patcher in reversed(self.patches):
			patcher.stop()
		self.temporary_dir.cleanup()

	def test_updates_fecho_to_sim(self):
		response = self.client.put(
			f'/api/af-files/{self.filename}/cells',
			json={'sheet': 'André Mota', 'row': 1, 'column': 7, 'value': 'Sim'},
		)

		self.assertEqual(response.status_code, 200)
		workbook = load_workbook(self.workbook_path, data_only=True)
		self.assertEqual(workbook['André Mota']['H2'].value, 'Sim')
		workbook.close()

	def test_rejects_invalid_fecho(self):
		response = self.client.put(
			f'/api/af-files/{self.filename}/cells',
			json={'sheet': 'André Mota', 'row': 1, 'column': 7, 'value': 'Talvez'},
		)

		self.assertEqual(response.status_code, 400)
		workbook = load_workbook(self.workbook_path, data_only=True)
		self.assertEqual(workbook['André Mota']['H2'].value, 'Não')
		workbook.close()


if __name__ == '__main__':
	unittest.main()
