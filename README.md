# ⚡ HW Media Social Analytics Dashboard

A live, self-updating social media analytics dashboard for HW Media — hosted on GitHub Pages and powered directly by a Google Sheet.

## 🔗 Live Dashboard

**[View Dashboard →](https://bellariverahw.github.io/hw-social-dashboard/)**

## 🔄 How It Updates

The dashboard reads data **live from Google Sheets** every time the page is loaded — no build step needed. Just update your spreadsheet and refresh the page.

A GitHub Actions workflow also redeploys the page automatically every day at 9 AM UTC so the URL stays fresh.

## 📊 Data Source

Google Sheet: [HousingWire Social Dashboard](https://docs.google.com/spreadsheets/d/16xSSv5WkRKg-ICv1jeTruJ4Q6H4POWpuwAJLHmVk1Pk)

### Sheet Structure

**Weekly tab** — one row per platform per week:
| Column | Description |
|---|---|
| `week_ending` | Date (YYYY-MM-DD, always a Friday) |
| `platform` | `linkedin`, `instagram`, `facebook`, `x`, or `tiktok` |
| `followers` | Total follower count that week |
| `total_engagement` | Total engagements that week |
| `posts_that_week` | Number of posts published |

**TopPosts tab** — top 3 posts per platform per week:
| Column | Description |
|---|---|
| `week_ending` | Same date as Weekly tab |
| `platform` | Platform name |
| `rank` | 1, 2, or 3 |
| `caption` | Post caption/text |
| `likes` | Like count |
| `comments` | Comment count |
| `shares` | Share/retweet count |
| `link` | URL to the post |

## 🚀 Setup

1. Go to **Settings → Pages** → set Source to **GitHub Actions**
2. Make sure your Google Sheet is set to **"Anyone with the link can view"**
3. The dashboard will be live at `https://bellariverahw.github.io/hw-social-dashboard/`

## 🛠 Tech Stack

- Pure HTML/CSS/JavaScript — no framework, no build step
- [Chart.js](https://www.chartjs.org/) for visualizations
- Google Sheets CSV export API for live data
- GitHub Pages for hosting (free)
- GitHub Actions for daily scheduled redeployment
