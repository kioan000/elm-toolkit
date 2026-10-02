module Counter exposing (main)

import Browser
import Html


main : Program () Int ()
main =
    Browser.sandbox
        { init = 0
        , update = \_ count -> count + 1
        , view = \count -> Html.text (String.fromInt count)
        }
