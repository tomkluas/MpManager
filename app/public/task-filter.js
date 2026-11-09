export function filterTasks(tasks,status='all'){return tasks.filter(t=>!t.deletedAt&&(status==='all'||t.status===status));}
