/**
 * FAQ (/faqs): questions and answers guests read on the public FAQ page (/faq, linked in the site footer;
 * the list is also at /faq.json). Staff add, edit, reorder, hide and delete them here.
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router = express.Router();
const CAN_MANAGE = [requireAuth, requireRole('admin', 'staff')];
const VALIDATE = [
  body('question').trim().notEmpty().withMessage('Write the question.').isLength({ max: 255 }).withMessage('The question is too long (255 characters at most).'),
  body('answer').trim().notEmpty().withMessage('Write the answer.').isLength({ max: 4000 }).withMessage('The answer is too long (4000 characters at most).'),
];

async function list() {
  return db.prepare('SELECT * FROM faqs ORDER BY sort_order, id').all();
}

router.get('/', ...CAN_MANAGE, async (req, res) => {
  res.render('faqs/index', { title: 'FAQ', layout: 'layouts/main', faqs: await list(), errors: [], old: { is_active: '1' }, editing: null });
});

router.post('/', ...CAN_MANAGE, VALIDATE, async (req, res) => {
  const errors = validationResult(req).array();
  if (errors.length) return res.status(422).render('faqs/index', { title: 'FAQ', layout: 'layouts/main', faqs: await list(), errors, old: req.body, editing: null });
  const next = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM faqs').get()).n;
  const id = (await db.prepare('INSERT INTO faqs (question, answer, sort_order, is_active) VALUES (?, ?, ?, ?)')
    .run(req.body.question.trim(), req.body.answer.trim(), next, req.body.is_active === '1' ? 1 : 0)).lastInsertRowid;
  await req.audit('create', 'faqs', id, null, { question: req.body.question.trim() });
  req.session.flash = { success: 'Question added.' };
  res.redirect('/faqs');
});

router.get('/:id/edit', ...CAN_MANAGE, async (req, res) => {
  const faq = await db.prepare('SELECT * FROM faqs WHERE id = ?').get(req.params.id);
  if (!faq) { req.session.flash = { error: 'Question not found.' }; return res.redirect('/faqs'); }
  res.render('faqs/index', { title: 'Edit question – FAQ', layout: 'layouts/main', faqs: await list(), errors: [], old: { ...faq, is_active: String(faq.is_active) }, editing: faq });
});

router.post('/:id/edit', ...CAN_MANAGE, VALIDATE, async (req, res) => {
  const faq = await db.prepare('SELECT * FROM faqs WHERE id = ?').get(req.params.id);
  if (!faq) { req.session.flash = { error: 'Question not found.' }; return res.redirect('/faqs'); }
  const errors = validationResult(req).array();
  if (errors.length) return res.status(422).render('faqs/index', { title: 'Edit question – FAQ', layout: 'layouts/main', faqs: await list(), errors, old: req.body, editing: faq });
  await db.prepare('UPDATE faqs SET question = ?, answer = ?, is_active = ?, updated_at = NOW() WHERE id = ?')
    .run(req.body.question.trim(), req.body.answer.trim(), req.body.is_active === '1' ? 1 : 0, faq.id);
  await req.audit('update', 'faqs', faq.id, { question: faq.question }, { question: req.body.question.trim() });
  req.session.flash = { success: 'Question saved.' };
  res.redirect('/faqs');
});

router.post('/:id/visibility', ...CAN_MANAGE, async (req, res) => {
  const show = req.body.show === '1';
  await db.prepare('UPDATE faqs SET is_active = ?, updated_at = NOW() WHERE id = ?').run(show ? 1 : 0, req.params.id);
  req.session.flash = { success: show ? 'The question is shown to guests again.' : 'The question is hidden from guests.' };
  res.redirect('/faqs');
});

// Move one place up or down.
router.post('/:id/move', ...CAN_MANAGE, async (req, res) => {
  const rows = await list();
  const i = rows.findIndex(r => String(r.id) === String(req.params.id));
  const j = req.body.dir === 'up' ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < rows.length) {
    [rows[i], rows[j]] = [rows[j], rows[i]];
    await db.transaction(async () => {
      for (let k = 0; k < rows.length; k++) await db.prepare('UPDATE faqs SET sort_order = ? WHERE id = ?').run(k + 1, rows[k].id);
    });
  }
  res.redirect('/faqs');
});

router.post('/:id/delete', ...CAN_MANAGE, async (req, res) => {
  const faq = await db.prepare('SELECT id, question FROM faqs WHERE id = ?').get(req.params.id);
  if (faq) {
    await db.prepare('DELETE FROM faqs WHERE id = ?').run(faq.id);
    await req.audit('delete', 'faqs', faq.id, { question: faq.question }, null);
  }
  req.session.flash = { success: 'Question deleted.' };
  res.redirect('/faqs');
});

module.exports = router;
