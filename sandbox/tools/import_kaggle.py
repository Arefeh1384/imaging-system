"""Puts real mammograms from Kaggle in place of the drawn sample images.

1. Download about 15 single-image mammography DICOM files (for example from the Kaggle competition
   "RSNA Screening Mammography Breast Cancer Detection", folder train_images) and put them in datasets/kaggle/.
2. Run, with Docker running:   docker compose run --rm sandbox python tools/import_kaggle.py
   To go back to the drawn images:  docker compose run --rm sandbox python tools/import_kaggle.py --restore

Each Kaggle file is given the fake patient, center and study details of one sample case, so the details in the
DICOM match the details the relay sends. The pixel data is not changed, so compressed files stay compressed.
Where a file says which breast it shows, it goes to a case for that breast.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import pydicom
from pydicom.uid import generate_uid

DATA = Path(os.environ.get('DATASETS_DIR', '/datasets'))
KAGGLE = DATA / 'kaggle'
DICOM = DATA / 'dicom'
DRAWN = DATA / 'dicom-drawn'

LATIN = {'R': 'RIGHT', 'L': 'LEFT'}


def side_of(ds) -> str | None:
    for keyword in ('ImageLaterality', 'Laterality'):
        value = str(getattr(ds, keyword, '') or '').strip().upper()
        if value in ('R', 'L'):
            return value
    return None


def restore() -> None:
    if not DRAWN.exists():
        print('Nothing to restore: the drawn images are already in use.')
        return
    for f in DRAWN.glob('*.dcm'):
        shutil.copy2(f, DICOM / f.name)
    cases = json.loads((DATA / 'cases.json').read_text(encoding='utf-8'))
    for c in cases['cases']:
        c.pop('imageSource', None)
    (DATA / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Restored {len(list(DRAWN.glob("*.dcm")))} drawn images.')


def main() -> int:
    if '--restore' in sys.argv:
        restore()
        return 0
    files = sorted(p for p in KAGGLE.rglob('*') if p.is_file() and p.suffix.lower() in ('.dcm', '.dicom', ''))
    if not files:
        print(f'No DICOM files in {KAGGLE}. Put the downloaded .dcm files there first.')
        return 1
    cases_doc = json.loads((DATA / 'cases.json').read_text(encoding='utf-8'))
    cases = [c for c in cases_doc['cases'] if c.get('image')]

    pool = []
    for f in files:
        try:
            ds = pydicom.dcmread(f, stop_before_pixels=True)
        except Exception as err:  # not a DICOM file
            print(f'skip {f.name}: {err}')
            continue
        pool.append((f, side_of(ds)))
    print(f'{len(pool)} DICOM files found for {len(cases)} cases.')

    DRAWN.mkdir(exist_ok=True)
    for f in DICOM.glob('*.dcm'):
        if not (DRAWN / f.name).exists():
            shutil.copy2(f, DRAWN / f.name)

    used = 0
    for case in cases:
        if not pool:
            print('Not enough files: the remaining cases keep their drawn images.')
            break
        want = case['study']['laterality']
        pick = next((p for p in pool if p[1] == want), None) or next((p for p in pool if p[1] is None), None) or pool[0]
        pool.remove(pick)
        source, side = pick
        ds = pydicom.dcmread(source)
        p, s = case['patient'], case['study']
        if side and side != s['laterality']:
            # The image shows the other breast: say so in the study details, so they stay true to the picture.
            s['laterality'] = side
            s['title'] = s['title'].replace('راست', '@').replace('چپ', 'راست').replace('@', 'چپ')
        ds.SpecificCharacterSet = 'ISO_IR 192'
        ds.PatientName = p['name']
        ds.PatientID = p['nationalId']
        ds.PatientBirthDate = p['birthDate'].replace('-', '')
        ds.PatientSex = 'F'
        ds.StudyDate = s['date'].replace('-', '')
        ds.AccessionNumber = s['accessionNumber']
        ds.InstitutionName = case['hospital']['name']
        ds.StudyDescription = s['title']
        ds.Modality = 'MG'
        ds.BodyPartExamined = 'BREAST'
        ds.ImageLaterality = s['laterality']
        ds.StudyInstanceUID = s['studyInstanceUid']
        ds.SeriesInstanceUID = s['studyInstanceUid'] + '.1'
        ds.SOPInstanceUID = generate_uid()
        ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
        ds.save_as(DICOM / f"{case['id']}.dcm", enforce_file_format=True)
        case['imageSource'] = f'kaggle/{source.name}'
        used += 1
        print(f"{case['id']}: {source.name} ({side or 'side unknown'})")

    (DATA / 'cases.json').write_text(json.dumps(cases_doc, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Done: {used} cases now use Kaggle images. Send them again from the PACS page.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
