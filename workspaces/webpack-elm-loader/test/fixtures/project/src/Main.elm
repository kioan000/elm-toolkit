module Main exposing (main)

import Browser
import Greeting
import Html


main : Program () () ()
main =
    Browser.sandbox
        { init = ()
        , update = \_ model -> model
        , view = \_ -> Html.text Greeting.text
        }
