import os
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd
from openpyxl import Workbook, load_workbook

import planos


class MarkAfPlansTests(unittest.TestCase):
	def test_import_only_updates_selected_person_af_sheet(self):
		with tempfile.TemporaryDirectory() as backend_dir:
			filename = 'AF_Janeiro2024.xlsx'
			workbook = Workbook()
			selected = workbook.active
			selected.title = 'André Mota'
			other = workbook.create_sheet('Simão Sá')
			headers = [
				'Nº de Sócio', 'Nome do Cliente', 'Nº Avaliação',
				'Avaliação Física', 'Plano de Treino', 'Dias de Diferença',
			]
			selected.append(headers)
			selected.append([123, 'Cliente', 1, pd.Timestamp('2024-01-10'), '-', '-'])
			other.append(headers)
			other.append([456, 'Outro cliente', 2, pd.Timestamp('2024-01-10'), 'existing', 7])
			workbook.save(os.path.join(backend_dir, filename))

			with patch.object(planos, 'BACKEND_DIR', backend_dir):
				planos._mark_af_plans(
					filename,
					{'123': [pd.Timestamp('2024-01-12')]},
					'André Mota',
				)

			workbook = load_workbook(os.path.join(backend_dir, filename), data_only=True)
			self.assertEqual(workbook['André Mota']['E2'].value, '12-01-2024')
			self.assertEqual(workbook['André Mota']['F2'].value, 2)
			self.assertEqual(workbook['Simão Sá']['E2'].value, 'existing')
			self.assertEqual(workbook['Simão Sá']['F2'].value, 7)
			workbook.close()


if __name__ == '__main__':
	unittest.main()
