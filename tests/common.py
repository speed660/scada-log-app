import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.environ.get('APP') or os.path.join(HERE, '..', 'index.html'))
FIXTURE = os.path.join(HERE, 'fixtures', 'sample-log.json')
OUT = tempfile.mkdtemp(prefix='scadalog-test-')
ME_SCRIPT = "try{localStorage.setItem('scadalog.me','Тест-диспетчер')}catch(e){}"
