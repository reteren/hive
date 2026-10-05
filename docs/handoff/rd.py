import json,sys
t=open(sys.argv[1],"rb").read().decode("utf-8","replace"); i=t.find('{')
if i<0: print(t); sys.exit()
try:
  d,end=json.JSONDecoder().raw_decode(t[i:]); d=d['result']; print('delivery',d['deliveryId'])
  for m in d['messages']: print(m['id'],m['type'],m['from_handle'][:22],m['subject'],'\n',m['body'][:4000],'\n',(m.get('payload') or '')[:900])
except Exception: print(t[:3000])
