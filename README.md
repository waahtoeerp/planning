# Planning Kanban

A simple kanban board for planning projects. Issues have a title, a description, a checklist, and labels (one per project, such as CRM or Product line optimization). Drag issues between columns, drag columns to reorder them, and filter by label.

The board is the single file `index.html`. Your data is stored in a Neon database (project `tektek`), so it's the same on every device.

## Who can use it

Only the GitHub account **waahtoeerp** can view or change the board. Anyone can open the page, but they see only the sign-in button.

## Using the board

1. Open https://waahtoeerp.github.io/planning/ and click **Sign in with GitHub**.
2. The board shows four columns: Backlog, In progress, In review, Ready.

| To do this | Do this |
|---|---|
| Add an issue | Click **+ New issue** |
| Edit an issue | Click **Edit** on the card, or double-click the card |
| Delete an issue | Click **Delete** on the card |
| Move an issue | Drag it to another column, or pick a column in the **Move to** menu on the card |
| Tick a checklist item | Click its checkbox on the card |
| Reorder columns | Drag a column by its **⋮⋮** handle |
| Rename a column | Click its name and type |
| Add a column | Click **+ Add column** at the end of the board |
| Delete a column | Click **✕** in its header. Its issues move to the first column. |
| Add or edit labels | Click **Manage labels**, or add one from inside an issue |
| Filter by project | Click a label chip at the top. Click again to remove the filter. |
| Sign out | Click **Sign out** |

Changes save straight to the database.

## Setup (for reference)

- **Hosting:** GitHub Pages, from the `main` branch, root folder. Repo: `waahtoeerp/planning`.
- **Database:** Neon project `tektek`, branch `production`. Tables start with `kanban_`.
- **Sign-in:** Neon Auth with GitHub. The GitHub OAuth app's client secret is kept only in the Neon console.
- **Access:** row-level security on every table. Only accounts listed in the `kanban_members` table can read or write, matched by GitHub account ID.

### Adding another person

1. Find their numeric GitHub ID: open `https://api.github.com/users/<their-username>` and copy the `id` number.
2. In the Neon console, open the `tektek` project's SQL editor and run:
   ```sql
   insert into kanban_members (github_id) values ('THEIR_ID_HERE');
   ```
3. They can now sign in with GitHub and use the board.

To remove someone, delete their row:
```sql
delete from kanban_members where github_id = 'THEIR_ID_HERE';
```

### Troubleshooting

- **Sign-in loops back to the sign-in button:** the browser is blocking the sign-in cookie. Try Chrome or Firefox, or allow third-party cookies for this site.
- **"Could not save" or the board is empty after signing in:** the account is not in `kanban_members`. Add it as described above.
