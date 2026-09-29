/**
 * The Python manifest readers behind `CodeCatalog.package_name` and `sdks` (ACP-455).
 * Each shape is written to a temp directory, so the fixture is the assertion.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { countPythonFiles, parseRequirement, readPythonManifests } from './manifests.js';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ziffer-py-manifests-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('parseRequirement', () => {
  it('reads name, extras, spec and marker', () => {
    assert.deepEqual(parseRequirement('mcp[cli]>=2.2 ; python_version >= "3.10"'), ['mcp', '>=2.2']);
    assert.deepEqual(parseRequirement('Pydantic_AI'), ['pydantic-ai', '*']);
    assert.deepEqual(parseRequirement('openai==3.19.2  # pinned'), ['openai', '==3.19.2']);
  });
});

describe('readPythonManifests', () => {
  it('PEP 621 multi-line dependencies, optional-dependencies, a comment holding a bracket', () => {
    const root = tree({
      'pyproject.toml': [
        '[project]',
        'name = "shop-agent"',
        'dependencies = [',
        '  "anthropic>=1.8",  # ] not the end',
        '  "requests",',
        ']',
        '[project.optional-dependencies]',
        'agents = ["openai-agents>=0.22", "crewai"]',
      ].join('\n'),
    });
    assert.deepEqual(readPythonManifests(root), {
      package_name: 'shop-agent',
      sdks: [
        { name: 'anthropic', version: '>=1.8' },
        { name: 'openai-agents', version: '>=0.22' },
        { name: 'crewai', version: '*' },
      ],
    });
  });

  it('Poetry tables, requirements*.txt, Pipfile and environment.yml, first declaration wins', () => {
    const root = tree({
      'pyproject.toml': [
        '[tool.poetry]',
        'name = "poetry-app"',
        '[tool.poetry.dependencies]',
        'python = "^3.11"',
        'langchain-core = "^1.6"',
        'fastmcp = { version = "^4.0", extras = ["cli"] }',
      ].join('\n'),
      'requirements-dev.txt': '-r requirements.txt\n# comment\ngoogle-genai>=2.25\nlangchain-core==0.1\ncohere>=7\n',
      'services/bot/Pipfile': '[packages]\nmistralai = "*"\npydantic-ai = "==2.51"\n',
      'services/etl/environment.yml': 'dependencies:\n  - python=3.11\n  - pip:\n    - instructor==1.17\n',
    });
    assert.deepEqual(readPythonManifests(root), {
      package_name: 'poetry-app',
      sdks: [
        { name: 'langchain-core', version: '^1.6' },
        { name: 'fastmcp', version: '^4.0' },
        { name: 'google-genai', version: '>=2.25' },
        { name: 'cohere', version: '>=7' },
        { name: 'mistralai', version: '*' },
        { name: 'pydantic-ai', version: '==2.51' },
        { name: 'instructor', version: '==1.17' },
      ],
    });
  });

  it('setup.cfg names the project when pyproject does not; skipped directories are not read', () => {
    const root = tree({
      'setup.cfg': '[metadata]\nname = legacy-app\n',
      '.venv/lib/requirements.txt': 'openai\n',
      'node_modules/x/requirements.txt': 'anthropic\n',
      'app/main.py': 'print(1)\n',
      '.venv/lib/site.py': 'print(1)\n',
    });
    assert.deepEqual(readPythonManifests(root), { package_name: 'legacy-app', sdks: [] });
    assert.equal(countPythonFiles(root), 1);
  });
});
