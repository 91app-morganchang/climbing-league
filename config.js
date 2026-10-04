// 資料來源設定：Google Sheet 只要分享為「知道連結的人可檢視」即可，不需要「發布到網路」。
// SHEET_ID 留空時，網頁會顯示 data/demo/ 內的示範資料。
export const SHEET_ID = '1oHTOkGgKsphD7Cpm85ooLX0WuyYEZEDvX9ANqNDBAko';

// 各分頁的 gid（開啟該分頁時網址最後的 gid=數字）
export const GIDS = {
  成績: '2019182253',
  選手: '1004414398',
  隊伍: '2053138472',
  設定: '490124525',
};

export const sheetUrl = (name) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&gid=${GIDS[name]}`;
