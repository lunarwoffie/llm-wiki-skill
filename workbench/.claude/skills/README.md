# Built-in Skills

This directory vendors the four stage-3 export skills from `anthropics/skills`.

- Source: https://github.com/anthropics/skills
- Commit: `690f15cac7f7b4c055c5ab109c79ed9259934081`
- Synced skills: `docx`, `pdf`, `pptx`, `xlsx`

Manual sync:

```bash
rm -rf /tmp/anthropics-skills
git clone https://github.com/anthropics/skills /tmp/anthropics-skills
rm -rf .claude/skills/{docx,pdf,pptx,xlsx}
cp -R /tmp/anthropics-skills/skills/{docx,pdf,pptx,xlsx} .claude/skills/
git -C /tmp/anthropics-skills rev-parse HEAD
```
